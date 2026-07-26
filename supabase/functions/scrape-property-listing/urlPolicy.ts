const ALLOWED_PROPERTY_LISTING_HOSTS = [
  "allhomes.com.au",
  "commercialrealestate.com.au",
  "domain.com.au",
  "onthehouse.com.au",
  "property.com.au",
  "realcommercial.com.au",
  "realestate.com.au",
  "view.com.au",
] as const;

function isAllowedPropertyListingHost(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
  return ALLOWED_PROPERTY_LISTING_HOSTS.some((allowedHost) =>
    normalizedHostname === allowedHost || normalizedHostname.endsWith(`.${allowedHost}`)
  );
}

export function normalizePropertyListingUrl(input: string): string {
  let formattedUrl = input.trim();
  if (!/^https?:\/\//i.test(formattedUrl)) {
    formattedUrl = `https://${formattedUrl}`;
  }

  const parsedUrl = new URL(formattedUrl);
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password || parsedUrl.port) {
    throw new Error("Property listing URL must use HTTPS without credentials or a custom port");
  }
  if (!isAllowedPropertyListingHost(parsedUrl.hostname)) {
    throw new Error("Unsupported property listing host");
  }

  return parsedUrl.toString();
}
