// Shared host policy for runtime detection and generated manifest matches.
export const GOOGLE_HOSTS = [
  "www.google.com",
  "google.com",
  "www.google.ae",
  "www.google.at",
  "www.google.be",
  "www.google.ca",
  "www.google.ch",
  "www.google.cl",
  "www.google.co.id",
  "www.google.co.il",
  "www.google.co.in",
  "www.google.co.jp",
  "www.google.co.kr",
  "www.google.co.nz",
  "www.google.co.th",
  "www.google.co.uk",
  "www.google.co.ve",
  "www.google.co.za",
  "www.google.com.ar",
  "www.google.com.au",
  "www.google.com.br",
  "www.google.com.co",
  "www.google.com.hk",
  "www.google.com.mx",
  "www.google.com.my",
  "www.google.com.pe",
  "www.google.com.ph",
  "www.google.com.sg",
  "www.google.com.tr",
  "www.google.com.tw",
  "www.google.com.ua",
  "www.google.com.vn",
  "www.google.de",
  "www.google.es",
  "www.google.fr",
  "www.google.it",
  "www.google.nl",
  "www.google.pl",
  "www.google.pt",
  "www.google.ru",
  "www.google.se"
];

export const BING_HOSTS = [
  "www.bing.com",
  "cn.bing.com",
  "bing.com"
];

export const SEARCH_MATCHES = [...BING_HOSTS, ...GOOGLE_HOSTS].map(host => `https://${host}/search*`);
