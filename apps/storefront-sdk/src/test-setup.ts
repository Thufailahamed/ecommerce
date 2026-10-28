// The unit tests run the storefront with every per-tool renderer already registered, which is what a page looks
// like once the lazily loaded scripts have arrived. The loading itself is covered in lazy.test.ts.
import "./chunk-toast";
import "./chunk-feed";
import "./chunk-upsell";
import "./chunk-email";
