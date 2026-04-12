/**
 * Real lat/lon coordinates for Greek cities used by the War Room map.
 * Add more cities here as XSlide expands to new locations.
 */
export const CITY_COORDS = {
  Athens:       { lat: 37.9838, lng: 23.7275 },
  Nafplion:     { lat: 37.5675, lng: 22.8015 },
  Corinth:      { lat: 37.9387, lng: 22.9271 },
  Thessaloniki: { lat: 40.6401, lng: 22.9444 },
  Patras:       { lat: 38.2466, lng: 21.7346 },
  Heraklion:    { lat: 35.3387, lng: 25.1442 },
  Rhodes:       { lat: 36.4341, lng: 28.2176 },
  Kalamata:     { lat: 37.0389, lng: 22.1144 },
  Volos:        { lat: 39.3667, lng: 22.9333 },
  Larissa:      { lat: 39.6390, lng: 22.4191 },
  Ioannina:     { lat: 39.6650, lng: 20.8537 },
  Tripoli:      { lat: 37.5100, lng: 22.3794 },
  Chania:       { lat: 35.5138, lng: 24.0180 },
  Kavala:       { lat: 40.9397, lng: 24.4019 },
  Alexandroupoli:{ lat: 40.8456, lng: 25.8738 },
  Sparta:       { lat: 37.0748, lng: 22.4297 },
  Pyrgos:       { lat: 37.6747, lng: 21.4390 },
  Chalkida:     { lat: 38.4628, lng: 23.5971 },
};

/**
 * Resolve a city name to coordinates.
 * Returns null if city not found — caller should skip or warn.
 */
export function getCityCoords(cityName) {
  // Try exact match first, then case-insensitive
  if (CITY_COORDS[cityName]) return CITY_COORDS[cityName];
  const key = Object.keys(CITY_COORDS).find(
    (k) => k.toLowerCase() === cityName.toLowerCase(),
  );
  return key ? CITY_COORDS[key] : null;
}
