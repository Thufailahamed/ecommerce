<?php
/**
 * Uninstall: remove the plugin's option on every site.
 *
 * The per-order meta `_convertflow_purchase_reported` is intentionally left on orders: it is a
 * timestamp only (no personal data) and keeps a reinstall from reporting old orders again.
 *
 * @package ConvertFlow
 */

defined( 'ABSPATH' ) || exit;
defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

if ( is_multisite() ) {
	$convertflow_site_ids = get_sites(
		array(
			'fields' => 'ids',
			'number' => 0,
		)
	);
	foreach ( $convertflow_site_ids as $convertflow_site_id ) {
		switch_to_blog( (int) $convertflow_site_id );
		delete_option( 'convertflow_settings' );
		restore_current_blog();
	}
} else {
	delete_option( 'convertflow_settings' );
}
