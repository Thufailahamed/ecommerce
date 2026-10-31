<?php
/**
 * Settings: WooCommerce > ConvertFlow, stored in the single option `convertflow_settings`.
 *
 * @package ConvertFlow
 */

defined( 'ABSPATH' ) || exit;

/**
 * Registers and renders the settings page and exposes validated settings to the rest of the plugin.
 */
class ConvertFlow_Settings {

	const OPTION       = 'convertflow_settings';
	const GROUP        = 'convertflow_settings_group';
	const PAGE         = 'convertflow';
	const CAPABILITY   = 'manage_woocommerce';
	const SITE_KEY_RE  = '/^cf_[A-Za-z0-9_-]{6,64}$/';
	const CONSENT_API  = 'wp_consent_api';
	const CONSENT_BANNER  = 'banner';
	const CONSENT_IMPLIED = 'implied';

	/**
	 * Hook suffix of the settings page, set when the menu is registered.
	 *
	 * @var string
	 */
	private $hook_suffix = '';

	/**
	 * Register hooks.
	 *
	 * @return void
	 */
	public function init() {
		// Tell the WP Consent API that this plugin follows it (front end and Site Health), only in that mode.
		$settings = self::get();
		if ( self::CONSENT_API === $settings['consent_mode'] ) {
			add_filter( 'wp_consent_api_registered_' . CONVERTFLOW_PLUGIN_BASENAME, '__return_true' );
		}

		if ( ! is_admin() ) {
			return;
		}
		add_action( 'admin_menu', array( $this, 'add_menu' ), 60 );
		add_action( 'admin_init', array( $this, 'register' ) );
		add_action( 'admin_notices', array( $this, 'missing_site_key_notice' ) );
		add_filter( 'option_page_capability_' . self::GROUP, array( $this, 'capability' ) );
		add_filter( 'plugin_action_links_' . CONVERTFLOW_PLUGIN_BASENAME, array( $this, 'action_links' ) );
	}

	/**
	 * Allowed consent modes.
	 *
	 * @return string[]
	 */
	public static function consent_modes() {
		return array( self::CONSENT_API, self::CONSENT_BANNER, self::CONSENT_IMPLIED );
	}

	/**
	 * Default values. The consent default follows whether the WP Consent API plugin is active.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			'site_key'     => '',
			'sdk_url'      => untrailingslashit( CONVERTFLOW_DEFAULT_SDK_URL ),
			'api_url'      => untrailingslashit( CONVERTFLOW_DEFAULT_API_URL ),
			'consent_mode' => function_exists( 'wp_has_consent' ) ? self::CONSENT_API : self::CONSENT_BANNER,
		);
	}

	/**
	 * Saved settings merged over the defaults, with every value type-checked.
	 *
	 * @return array{site_key:string,sdk_url:string,api_url:string,consent_mode:string}
	 */
	public static function get() {
		$defaults = self::defaults();
		$saved    = get_option( self::OPTION, array() );
		if ( ! is_array( $saved ) ) {
			$saved = array();
		}
		$out = array();
		foreach ( $defaults as $key => $default ) {
			$value       = isset( $saved[ $key ] ) && is_string( $saved[ $key ] ) ? $saved[ $key ] : '';
			$out[ $key ] = '' === $value ? $default : $value;
		}
		if ( ! in_array( $out['consent_mode'], self::consent_modes(), true ) ) {
			$out['consent_mode'] = $defaults['consent_mode'];
		}
		return $out;
	}

	/**
	 * Whether a site key has the public key format issued by the ConvertFlow dashboard.
	 *
	 * @param mixed $key Candidate key.
	 * @return bool
	 */
	public static function is_valid_site_key( $key ) {
		return is_string( $key ) && 1 === preg_match( self::SITE_KEY_RE, $key );
	}

	/**
	 * URL of the settings page.
	 *
	 * @return string
	 */
	public static function page_url() {
		return admin_url( 'admin.php?page=' . self::PAGE );
	}

	/**
	 * Capability required to save the option through options.php.
	 *
	 * @return string
	 */
	public function capability() {
		return self::CAPABILITY;
	}

	/**
	 * Add WooCommerce > ConvertFlow.
	 *
	 * @return void
	 */
	public function add_menu() {
		$hook = add_submenu_page(
			'woocommerce',
			__( 'ConvertFlow', 'convertflow' ),
			__( 'ConvertFlow', 'convertflow' ),
			self::CAPABILITY,
			self::PAGE,
			array( $this, 'render_page' )
		);
		if ( is_string( $hook ) ) {
			$this->hook_suffix = $hook;
		}
	}

	/**
	 * Register the setting, section and fields with the Settings API.
	 *
	 * @return void
	 */
	public function register() {
		register_setting(
			self::GROUP,
			self::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( $this, 'sanitize' ),
				'default'           => array(),
				'show_in_rest'      => false,
			)
		);

		add_settings_section(
			'convertflow_main',
			__( 'Store connection', 'convertflow' ),
			array( $this, 'render_section' ),
			self::PAGE
		);

		add_settings_field( 'convertflow_site_key', __( 'Site key', 'convertflow' ), array( $this, 'render_site_key' ), self::PAGE, 'convertflow_main', array( 'label_for' => 'convertflow_site_key' ) );
		add_settings_field( 'convertflow_consent_mode', __( 'Consent', 'convertflow' ), array( $this, 'render_consent_mode' ), self::PAGE, 'convertflow_main' );
		add_settings_field( 'convertflow_sdk_url', __( 'Script URL (advanced)', 'convertflow' ), array( $this, 'render_sdk_url' ), self::PAGE, 'convertflow_main', array( 'label_for' => 'convertflow_sdk_url' ) );
		add_settings_field( 'convertflow_api_url', __( 'API URL (advanced)', 'convertflow' ), array( $this, 'render_api_url' ), self::PAGE, 'convertflow_main', array( 'label_for' => 'convertflow_api_url' ) );
	}

	/**
	 * Sanitize callback for the whole option. Invalid values are rejected with an error and the previous value is kept.
	 *
	 * @param mixed $input Submitted value (already unslashed by options.php).
	 * @return array
	 */
	public function sanitize( $input ) {
		$current = self::get();
		if ( ! is_array( $input ) ) {
			return $current;
		}
		$out = $current;

		// Site key.
		$key = isset( $input['site_key'] ) && is_string( $input['site_key'] ) ? trim( sanitize_text_field( $input['site_key'] ) ) : '';
		if ( '' === $key || self::is_valid_site_key( $key ) ) {
			$out['site_key'] = $key;
		} else {
			add_settings_error(
				self::OPTION,
				'convertflow_site_key',
				__( 'The site key was not saved: it must look like cf_ followed by 6 to 64 letters, digits, "_" or "-". Copy it from ConvertFlow > Settings > Install.', 'convertflow' )
			);
		}

		// URLs.
		$sdk = $this->sanitize_url( isset( $input['sdk_url'] ) ? $input['sdk_url'] : '', __( 'Script URL', 'convertflow' ) );
		if ( null !== $sdk ) {
			// Accept a pasted ".../cf.js" and store the base URL.
			$sdk            = preg_replace( '#/cf\.js$#i', '', $sdk );
			$out['sdk_url'] = '' === $sdk ? self::defaults()['sdk_url'] : $sdk;
		}
		$api = $this->sanitize_url( isset( $input['api_url'] ) ? $input['api_url'] : '', __( 'API URL', 'convertflow' ) );
		if ( null !== $api ) {
			$out['api_url'] = '' === $api ? self::defaults()['api_url'] : $api;
		}

		// Consent mode.
		$mode = isset( $input['consent_mode'] ) && is_string( $input['consent_mode'] ) ? sanitize_key( $input['consent_mode'] ) : '';
		if ( in_array( $mode, self::consent_modes(), true ) ) {
			$out['consent_mode'] = $mode;
		}

		return $out;
	}

	/**
	 * Validate and normalise a base URL. Returns '' for "use the default", null when invalid (error added).
	 *
	 * @param mixed  $value Submitted value.
	 * @param string $label Field label for the error message.
	 * @return string|null
	 */
	private function sanitize_url( $value, $label ) {
		$value = is_string( $value ) ? trim( $value ) : '';
		if ( '' === $value ) {
			return '';
		}
		$url   = esc_url_raw( $value, array( 'https', 'http' ) );
		$parts = '' === $url ? false : wp_parse_url( $url );
		$valid = is_array( $parts ) && ! empty( $parts['scheme'] ) && ! empty( $parts['host'] ) && ! isset( $parts['user'] ) && ! isset( $parts['pass'] );

		if ( $valid && 'https' !== strtolower( $parts['scheme'] ) && ! self::allows_insecure( $parts['host'] ) ) {
			add_settings_error(
				self::OPTION,
				'convertflow_url_https',
				/* translators: %s: field label, e.g. "Script URL". */
				sprintf( __( '%s was not saved: it must start with https:// (http:// is only accepted for localhost or when WP_DEBUG is on).', 'convertflow' ), $label )
			);
			return null;
		}
		if ( ! $valid ) {
			add_settings_error(
				self::OPTION,
				'convertflow_url_invalid',
				/* translators: %s: field label, e.g. "Script URL". */
				sprintf( __( '%s was not saved: it is not a valid URL.', 'convertflow' ), $label )
			);
			return null;
		}

		// Rebuild without query string or fragment; the plugin appends paths itself.
		$clean = strtolower( $parts['scheme'] ) . '://' . $parts['host'];
		if ( ! empty( $parts['port'] ) ) {
			$clean .= ':' . (int) $parts['port'];
		}
		if ( ! empty( $parts['path'] ) ) {
			$clean .= $parts['path'];
		}
		return untrailingslashit( $clean );
	}

	/**
	 * Whether a plain-http URL is acceptable for this host.
	 *
	 * @param string $host URL host.
	 * @return bool
	 */
	private static function allows_insecure( $host ) {
		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			return true;
		}
		$host = strtolower( trim( (string) $host, '[]' ) );
		return in_array( $host, array( 'localhost', '127.0.0.1', '::1' ), true ) || '.localhost' === substr( $host, -10 );
	}

	/**
	 * Settings link on the Plugins screen.
	 *
	 * @param string[] $links Existing links.
	 * @return string[]
	 */
	public function action_links( $links ) {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			return $links;
		}
		$link = sprintf( '<a href="%s">%s</a>', esc_url( self::page_url() ), esc_html__( 'Settings', 'convertflow' ) );
		array_unshift( $links, $link );
		return $links;
	}

	/**
	 * Notice for store managers while no valid site key is saved.
	 *
	 * @return void
	 */
	public function missing_site_key_notice() {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			return;
		}
		$settings = self::get();
		if ( self::is_valid_site_key( $settings['site_key'] ) ) {
			return;
		}
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( $screen && '' !== $this->hook_suffix && $this->hook_suffix === $screen->id ) {
			return;
		}
		printf(
			'<div class="notice notice-warning"><p>%1$s <a href="%2$s">%3$s</a></p></div>',
			esc_html__( 'ConvertFlow AI is not showing campaigns yet because no site key is set.', 'convertflow' ),
			esc_url( self::page_url() ),
			esc_html__( 'Add your site key', 'convertflow' )
		);
	}

	/**
	 * Render the settings page.
	 *
	 * @return void
	 */
	public function render_page() {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			return;
		}
		?>
		<div class="wrap">
			<h1><?php echo esc_html( get_admin_page_title() ); ?></h1>
			<?php settings_errors(); ?>
			<form action="<?php echo esc_url( admin_url( 'options.php' ) ); ?>" method="post">
				<?php
				settings_fields( self::GROUP );
				do_settings_sections( self::PAGE );
				submit_button();
				?>
			</form>
		</div>
		<?php
	}

	/**
	 * Section intro.
	 *
	 * @return void
	 */
	public function render_section() {
		echo '<p>' . esc_html__( 'Connect this store to ConvertFlow AI. The storefront script is added to every shop page once a valid site key is saved. Product and order data are synced separately through the WooCommerce REST API connection made in the ConvertFlow dashboard.', 'convertflow' ) . '</p>';
	}

	/**
	 * Site key field.
	 *
	 * @return void
	 */
	public function render_site_key() {
		$settings = self::get();
		printf(
			'<input type="text" id="convertflow_site_key" name="%1$s[site_key]" value="%2$s" class="regular-text code" pattern="cf_[A-Za-z0-9_\-]{6,64}" placeholder="cf_AbC123xyz456" autocomplete="off" spellcheck="false" />',
			esc_attr( self::OPTION ),
			esc_attr( $settings['site_key'] )
		);
		echo '<p class="description">' . esc_html__( 'Copy it from ConvertFlow > Settings > Install. It is public and safe to show in page source.', 'convertflow' ) . '</p>';
	}

	/**
	 * Consent mode field.
	 *
	 * @return void
	 */
	public function render_consent_mode() {
		$settings = self::get();
		$options  = array(
			self::CONSENT_API     => __( 'WP Consent API: follow the visitor\'s "statistics" choice from a compatible cookie banner plugin.', 'convertflow' ),
			self::CONSENT_BANNER  => __( 'My own cookie banner: my banner sets window.ConvertFlow.consent to true or false.', 'convertflow' ),
			self::CONSENT_IMPLIED => __( 'No consent required: visitors in my store\'s jurisdiction do not need to opt in to analytics. I am responsible for this choice.', 'convertflow' ),
		);
		echo '<fieldset><legend class="screen-reader-text">' . esc_html__( 'Consent', 'convertflow' ) . '</legend>';
		foreach ( $options as $value => $label ) {
			printf(
				'<label><input type="radio" name="%1$s[consent_mode]" value="%2$s" %3$s /> %4$s</label><br />',
				esc_attr( self::OPTION ),
				esc_attr( $value ),
				checked( $settings['consent_mode'], $value, false ),
				esc_html( $label )
			);
		}
		echo '</fieldset>';
		if ( self::CONSENT_API === $settings['consent_mode'] && ! function_exists( 'wp_has_consent' ) ) {
			echo '<p class="description"><strong>' . esc_html__( 'The WP Consent API plugin is not active, so consent stays unknown and ConvertFlow will not store or send analytics until it is.', 'convertflow' ) . '</strong></p>';
		}
		echo '<p class="description">' . esc_html__( 'Campaigns are always shown; this setting only controls whether ConvertFlow may store and send analytics.', 'convertflow' ) . '</p>';
	}

	/**
	 * Script URL field.
	 *
	 * @return void
	 */
	public function render_sdk_url() {
		$settings = self::get();
		printf(
			'<input type="url" id="convertflow_sdk_url" name="%1$s[sdk_url]" value="%2$s" class="regular-text code" placeholder="%3$s" />',
			esc_attr( self::OPTION ),
			esc_attr( $settings['sdk_url'] ),
			esc_attr( CONVERTFLOW_DEFAULT_SDK_URL )
		);
		echo '<p class="description">' . esc_html__( 'Base URL the cf.js script is loaded from. Leave empty for the default.', 'convertflow' ) . '</p>';
	}

	/**
	 * API URL field.
	 *
	 * @return void
	 */
	public function render_api_url() {
		$settings = self::get();
		printf(
			'<input type="url" id="convertflow_api_url" name="%1$s[api_url]" value="%2$s" class="regular-text code" placeholder="%3$s" />',
			esc_attr( self::OPTION ),
			esc_attr( $settings['api_url'] ),
			esc_attr( CONVERTFLOW_DEFAULT_API_URL )
		);
		echo '<p class="description">' . esc_html__( 'Leave empty for the default.', 'convertflow' ) . '</p>';
	}
}
