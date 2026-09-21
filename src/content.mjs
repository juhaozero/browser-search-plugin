import { bootSearchPage } from "./content-boot.mjs";

if (typeof location !== "undefined" && typeof document !== "undefined" && location.href) {
  void bootSearchPage(document, location.href);
}
