<?php
/**
 * Plugin Name:          ConvertFlow AI for WooCommerce
 * Plugin URI:           https://convertflow.example
 * Description:          Loads the ConvertFlow AI storefront script with exact WooCommerce page context and reports completed orders for campaign attribution.
 * Version:              1.0.0
 * Requires at least:    6.2
 * Requires PHP:         7.4
 * Requires Plugins:     woocommerce
 * Author:               ConvertFlow AI
 * License:              GPL-2.0-or-later
 * License URI:          https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:          convertflow
 * Domain Path:          /languages
 * WC requires at least: 8.0
 * WC tested up to:      9.9
 *
 * @package ConvertFlow
 */

defined( 'ABSPATH' ) || exit;

define( 'CONVERTFLOW_VERSION', '1.0.0' );
define( 'CONVERTFLOW_PLUGIN_FILE', __FILE__ );
define( 'CONVERTFLOW_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'CONVERTFLOW_PLUGIN_BASENAME', plugin_basename( __FILE__ ) );

// Overridable from wp-config.php (for example to point a staging store at a staging stack).
if ( ! defined( 'CONVERTFLOW_DEFAULT_SDK_URL' ) ) {
	define( 'CONVERTFLOW_DEFAULT_SDK_URL', 'https://sdk.convertflow.example' );
}
if ( ! defined( 'CONVERTFLOW_DEFAULT_API_URL' ) ) {
	define( 'CONVERTFLOW_DEFAULT_API_URL', 'https://api.convertflow.example' );
}

/**
 * Declare compatibility with High-Performance Order Storage and the Cart/Checkout blocks.
 *
 * @return void
 */
function convertflow_declare_wc_compatibility() {
	if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', CONVERTFLOW_PLUGIN_FILE, true );
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', CONVERTFLOW_PLUGIN_FILE, true );
	}
}
add_action( 'before_woocommerce_init', 'convertflow_declare_wc_compatibility' );

/**
 * Load translations.
 *
 * @return void
 */
function convertflow_load_textdomain() {
	load_plugin_textdomain( 'convertflow', false, dirname( CONVERTFLOW_PLUGIN_BASENAME ) . '/languages' );
}
add_action( 'init', 'convertflow_load_textdomain' );

/**
 * Whether WooCommerce is loaded.
 *
 * @return bool
 */
function convertflow_is_woocommerce_active() {
	return class_exists( 'WooCommerce' ) && function_exists( 'WC' );
}

/**
 * Admin notice shown when WooCommerce is not active. The plugin stays dormant in that case.
 *
 * @return void
 */
function convertflow_missing_woocommerce_notice() {
	if ( ! current_user_can( 'activate_plugins' ) ) {
		return;
	}
	printf(
		'<div class="notice notice-error"><p>%s</p></div>',
		esc_html__( 'ConvertFlow AI for WooCommerce needs WooCommerce to be installed and active. It does nothing until WooCommerce is active.', 'convertflow' )
	);
}

/**
 * Boot the plugin once all plugins are loaded.
 *
 * @return void
 */
function convertflow_bootstrap() {
	if ( ! convertflow_is_woocommerce_active() ) {
		add_action( 'admin_notices', 'convertflow_missing_woocommerce_notice' );
		return;
	}

	require_once CONVERTFLOW_PLUGIN_DIR . 'includes/class-convertflow-settings.php';
	require_once CONVERTFLOW_PLUGIN_DIR . 'includes/class-convertflow-frontend.php';

	$settings = new ConvertFlow_Settings();
	$settings->init();

	$frontend = new ConvertFlow_Frontend();
	$frontend->init();
}
add_action( 'plugins_loaded', 'convertflow_bootstrap' );
