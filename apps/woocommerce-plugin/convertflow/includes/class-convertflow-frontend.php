<?php
/**
 * Front end: consent bootstrap, exact page context, the storefront script tag and purchase reporting.
 *
 * @package ConvertFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Prints the storefront integration on shop pages.
 */
class ConvertFlow_Frontend {

	const HANDLE        = 'convertflow-sdk';
	const REPORTED_META = '_convertflow_purchase_reported';
	const JSON_FLAGS    = JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT;

	/**
	 * Orders already printed in this request (woocommerce_thankyou plus the wp_footer fallback).
	 *
	 * @var array<int,bool>
	 */
	private $printed_orders = array();

	/**
	 * Register hooks.
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue' ) );
		// wp_enqueue_scripts runs at wp_head:1 and head scripts print at wp_head:9, so this lands before cf.js.
		add_action( 'wp_head', array( $this, 'print_bootstrap' ), 2 );
		add_filter( 'script_loader_tag', array( $this, 'script_tag' ), 10, 2 );
		add_action( 'woocommerce_thankyou', array( $this, 'on_thankyou' ), 20 );
		// Fallback for order-confirmation templates that do not fire woocommerce_thankyou.
		add_action( 'wp_footer', array( $this, 'thankyou_fallback' ), 20 );
	}

	/**
	 * Whether the integration should run on this request.
	 *
	 * @return bool
	 */
	private function should_load() {
		if ( is_admin() || wp_doing_ajax() || wp_doing_cron() ) {
			return false;
		}
		if ( ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'XMLRPC_REQUEST' ) && XMLRPC_REQUEST ) ) {
			return false;
		}
		if ( is_feed() || is_robots() || is_trackback() || is_embed() ) {
			return false;
		}
		$settings = ConvertFlow_Settings::get();
		$load     = ConvertFlow_Settings::is_valid_site_key( $settings['site_key'] ) && '' !== $settings['sdk_url'] && '' !== $settings['api_url'];

		/**
		 * Filters whether ConvertFlow loads on the current request.
		 *
		 * @param bool $load Whether to load.
		 */
		return (bool) apply_filters( 'convertflow_should_load', $load );
	}

	/**
	 * Call a WooCommerce conditional tag only if it exists.
	 *
	 * @param string $fn Function name.
	 * @return bool
	 */
	private function wc_is( $fn ) {
		return function_exists( $fn ) && (bool) call_user_func( $fn );
	}

	/**
	 * Whether this is the order-received (thank-you) endpoint.
	 *
	 * @return bool
	 */
	private function is_order_received() {
		return $this->wc_is( 'is_order_received_page' );
	}

	/**
	 * Enqueue cf.js (the tag itself is rewritten in script_tag()).
	 *
	 * @return void
	 */
	public function enqueue() {
		if ( ! $this->should_load() ) {
			return;
		}
		$settings = ConvertFlow_Settings::get();
		// Version null: no "?ver=" query, the SDK URL is used exactly. In head (false) so campaigns can start early; it is async.
		wp_enqueue_script( self::HANDLE, $settings['sdk_url'] . '/cf.js', array(), null, false );
	}

	/**
	 * Replace the generated tag with exactly the tag the SDK expects.
	 *
	 * @param string $tag    Generated tag.
	 * @param string $handle Script handle.
	 * @return string
	 */
	public function script_tag( $tag, $handle ) {
		if ( self::HANDLE !== $handle ) {
			return $tag;
		}
		$settings = ConvertFlow_Settings::get();
		return sprintf(
			'<script async src="%1$s" data-site="%2$s" data-api="%3$s"></script>' . "\n", // phpcs:ignore WordPress.WP.EnqueuedResources.NonEnqueuedScript -- this is the enqueued script's own tag.
			esc_url( $settings['sdk_url'] . '/cf.js' ),
			esc_attr( $settings['site_key'] ),
			esc_url( $settings['api_url'] )
		);
	}

	/**
	 * Print window.ConvertFlow (consent) and window.ConvertFlowContext (page data) before cf.js.
	 *
	 * @return void
	 */
	public function print_bootstrap() {
		if ( ! $this->should_load() ) {
			return;
		}
		$settings = ConvertFlow_Settings::get();
		$context  = wp_json_encode( $this->page_context(), self::JSON_FLAGS );
		if ( false === $context ) {
			return;
		}

		$js = 'window.ConvertFlow = window.ConvertFlow || {};' . "\n" . $this->consent_js( $settings['consent_mode'] ) . 'window.ConvertFlowContext = ' . $context . ';';

		wp_print_inline_script_tag( $js, array( 'id' => 'convertflow-context-js' ) );
	}

	/**
	 * Consent bootstrap for the chosen mode.
	 *
	 * @param string $mode Consent mode.
	 * @return string JavaScript.
	 */
	private function consent_js( $mode ) {
		if ( ConvertFlow_Settings::CONSENT_IMPLIED === $mode ) {
			return 'window.ConvertFlow.consent = true;' . "\n";
		}
		if ( ConvertFlow_Settings::CONSENT_API === $mode ) {
			// wp_has_consent() may be defined by a footer script, so read again at DOMContentLoaded; then follow changes.
			return '(function (w, d) {'
				. ' var cf = w.ConvertFlow;'
				. ' function read() { if (typeof w.wp_has_consent === "function") { try { cf.consent = !!w.wp_has_consent("statistics"); } catch (e) {} } }'
				. ' read();'
				. ' d.addEventListener("DOMContentLoaded", read);'
				. ' d.addEventListener("wp_listen_for_consent_change", function (e) {'
				. ' var c = e && e.detail;'
				. ' if (c && Object.prototype.hasOwnProperty.call(c, "statistics")) { cf.consent = c.statistics === "allow"; } else { read(); }'
				. ' });'
				. ' })(window, document);' . "\n";
		}
		// Banner mode: the merchant's own cookie banner sets window.ConvertFlow.consent. Until then consent is unknown (treated as no).
		return '';
	}

	/**
	 * Exact page data for the SDK. Anything not known is omitted, never guessed.
	 *
	 * @return array
	 */
	private function page_context() {
		$context = array( 'pageType' => $this->page_type() );

		if ( 'product' === $context['pageType'] && function_exists( 'wc_get_product' ) ) {
			$product = wc_get_product( get_queried_object_id() );
			if ( $product instanceof WC_Product ) {
				$context['productId']        = (string) $product->get_id();
				$context['productAvailable'] = (bool) $product->is_in_stock();
				$category_ids                = array_values( array_filter( array_map( 'absint', (array) $product->get_category_ids() ) ) );
				if ( $category_ids ) {
					$context['collectionIds'] = array_map( 'strval', $category_ids );
				}
			}
		} elseif ( 'collection' === $context['pageType'] && $this->wc_is( 'is_product_category' ) ) {
			$term = get_queried_object();
			if ( $term instanceof WP_Term && 'product_cat' === $term->taxonomy ) {
				$context['collectionIds'] = array( (string) $term->term_id );
			}
		}

		$cart = $this->cart_context();
		if ( $cart ) {
			$context = array_merge( $context, $cart );
		}

		/**
		 * Filters the page context passed to the storefront script as window.ConvertFlowContext.
		 *
		 * @param array $context Page context. Leave unknown values out rather than guessing.
		 */
		$filtered = apply_filters( 'convertflow_page_context', $context );
		return is_array( $filtered ) && isset( $filtered['pageType'] ) ? $filtered : $context;
	}

	/**
	 * Page type from WordPress / WooCommerce conditional tags.
	 *
	 * @return string
	 */
	private function page_type() {
		if ( is_front_page() ) {
			return 'home';
		}
		if ( $this->wc_is( 'is_product' ) ) {
			return 'product';
		}
		// Before the shop check: a product search is also a product archive (is_shop() is true), but it is a search.
		if ( is_search() ) {
			return 'search';
		}
		if ( $this->wc_is( 'is_product_category' ) || $this->wc_is( 'is_product_tag' ) || $this->wc_is( 'is_shop' ) ) {
			return 'collection';
		}
		if ( $this->wc_is( 'is_cart' ) ) {
			return 'cart';
		}
		if ( $this->is_order_received() ) {
			return 'other';
		}
		if ( $this->wc_is( 'is_checkout' ) ) {
			return 'checkout';
		}
		if ( is_page() || is_single() ) {
			return 'content';
		}
		return 'other';
	}

	/**
	 * Cart subtotal (as the store displays it: incl. or excl. tax) and item count, when the cart is available.
	 *
	 * @return array
	 */
	private function cart_context() {
		if ( ! function_exists( 'WC' ) || ! class_exists( 'WC_Cart' ) ) {
			return array();
		}
		$wc = WC();
		if ( ! $wc || ! isset( $wc->cart ) || ! ( $wc->cart instanceof WC_Cart ) ) {
			return array();
		}
		$cart = $wc->cart;
		$cart->get_cart(); // Loads the cart from the session if that has not happened yet.

		$subtotal = (float) $cart->get_subtotal();
		if ( $cart->display_prices_including_tax() ) {
			$subtotal += (float) $cart->get_subtotal_tax();
		}
		$decimals = function_exists( 'wc_get_price_decimals' ) ? (int) wc_get_price_decimals() : 2;

		return array(
			'cartSubtotal'  => round( $subtotal, $decimals ),
			'cartItemCount' => (int) $cart->get_cart_contents_count(),
		);
	}

	/**
	 * Thank-you hook (classic checkout template and the block order-confirmation template).
	 *
	 * @param int $order_id Order id.
	 * @return void
	 */
	public function on_thankyou( $order_id ) {
		$this->maybe_print_purchase( absint( $order_id ) );
	}

	/**
	 * Print the purchase call from wp_footer if woocommerce_thankyou did not fire on the order-received page.
	 *
	 * @return void
	 */
	public function thankyou_fallback() {
		if ( ! $this->is_order_received() ) {
			return;
		}
		global $wp;
		$order_id = ( $wp instanceof WP && isset( $wp->query_vars['order-received'] ) ) ? absint( $wp->query_vars['order-received'] ) : 0;
		$this->maybe_print_purchase( $order_id );
	}

	/**
	 * Print a one-time ConvertFlow.trackPurchase call for a verified order. Only id, total and currency are sent.
	 *
	 * @param int $order_id Order id.
	 * @return void
	 */
	private function maybe_print_purchase( $order_id ) {
		if ( ! $order_id || isset( $this->printed_orders[ $order_id ] ) || ! function_exists( 'wc_get_order' ) || ! $this->should_load() ) {
			return;
		}
		$order = wc_get_order( $order_id );
		if ( ! ( $order instanceof WC_Order ) ) {
			return;
		}

		// The order key in the URL must match, so an order id alone cannot expose someone else's order.
		$key = isset( $_GET['key'] ) ? sanitize_text_field( wp_unslash( $_GET['key'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only comparison against the order key.
		if ( '' === $key || ! hash_equals( (string) $order->get_order_key(), $key ) ) {
			return;
		}
		if ( $order->has_status( array( 'failed', 'cancelled' ) ) || $order->get_meta( self::REPORTED_META ) ) {
			return;
		}

		$total    = (float) $order->get_total();
		$currency = (string) $order->get_currency();
		if ( '' === $currency || ! is_finite( $total ) ) {
			return;
		}

		$payload = wp_json_encode(
			array(
				// Same id the server records from the order webhook, so the order counts once; this call adds attribution.
				'orderId'  => 'woocommerce:' . $order->get_id(),
				'total'    => $total,
				'currency' => $currency,
			),
			self::JSON_FLAGS
		);
		if ( false === $payload ) {
			return;
		}
		$this->printed_orders[ $order_id ] = true;

		// Wait up to 15 s (60 x 250 ms) for the async SDK, then call trackPurchase once.
		$js = '(function (w) {'
			. ' var order = ' . $payload . ', tries = 0, done = false;'
			. ' function attempt() {'
			. ' if (done) { return; }'
			. ' var cf = w.ConvertFlow;'
			. ' if (cf && typeof cf.trackPurchase === "function") { done = true; try { cf.trackPurchase(order); } catch (e) {} return; }'
			. ' if (++tries < 60) { w.setTimeout(attempt, 250); }'
			. ' }'
			. ' attempt();'
			. ' })(window);';
		wp_print_inline_script_tag( $js, array( 'id' => 'convertflow-purchase-js' ) );

		try {
			$order->update_meta_data( self::REPORTED_META, gmdate( 'c' ) );
			$order->save();
		} catch ( Exception $e ) {
			// Never break the thank-you page. Worst case the call is printed again on a reload; the server de-duplicates by order id.
			unset( $e );
		}
	}
}
