/**
 * Verified photography used by the editorial catalogue and trip covers (§75).
 * Every consumer renders through `AppImage`, which falls back to a branded
 * gradient if the CDN is unreachable — the app never depends on it blindly.
 */

const unsplash = (id: string, width = 1200) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${width}&q=80`;

export const IMAGES = {
  paris: unsplash('1502602898657-3e91760cbb34'),
  kyoto: unsplash('1493976040374-85c8e12f0c0e'),
  rome: unsplash('1552832230-c0197dd311b5'),
  newYork: unsplash('1496442226666-8d4d0e62e6e9'),
  tokyo: unsplash('1540959733332-eab4deabeeaf'),
  lisbon: unsplash('1585208798174-6cedd86e019a'),
  santorini: unsplash('1524413840807-0c3cb6fa808d'),
  barcelona: unsplash('1528181304800-259b08848526'),
  alps: unsplash('1512470876302-972faa2aa9a4'),
  coast: unsplash('1467269204594-9661b134dd2b'),
  hotelRoom: unsplash('1566073771259-6a8506099945'),
  hotelLobby: unsplash('1517248135467-4c7edcad34c4'),
  restaurantTable: unsplash('1414235077428-338989a2e8c0'),
  restaurantChef: unsplash('1590490360182-c33d57733427'),
  ramen: unsplash('1551882547-ff40c63fe5fa'),
  pasta: unsplash('1476224203421-9ac39bcb3327'),
  luggage: unsplash('1517840901100-8179e982acb7'),
  passport: unsplash('1541971875076-8f970d573be6'),
  hotelSuite: unsplash('1600585154340-be6161a56a0c'),
  bistro: unsplash('1571896349842-33c89424de2d'),
  airplaneWing: unsplash('1444723121867-7a241cacace9'),
  mapPlanning: unsplash('1523906834658-6e24ef2386f9'),
} as const;

/** Strips accents so "Tóquio" and "Toquio" resolve to the same key. */
export function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

const COVER_BY_CITY: Record<string, string> = {
  paris: IMAGES.paris,
  kyoto: IMAGES.kyoto,
  quioto: IMAGES.kyoto,
  roma: IMAGES.rome,
  rome: IMAGES.rome,
  'nova york': IMAGES.newYork,
  'new york': IMAGES.newYork,
  toquio: IMAGES.tokyo,
  tokyo: IMAGES.tokyo,
  lisboa: IMAGES.lisbon,
  lisbon: IMAGES.lisbon,
  santorini: IMAGES.santorini,
  barcelona: IMAGES.barcelona,
};

/** Suggests a cover for a destination the user typed, with a sane default. */
export function suggestCoverImage(city: string): string {
  return COVER_BY_CITY[normalizeKey(city)] ?? IMAGES.coast;
}
