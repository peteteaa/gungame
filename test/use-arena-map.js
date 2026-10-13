// Imported first by the integration tests, before anything loads shared/constants.js: their positions
// ("center box", "corner tower") are written against the arena layout, not the real map.
process.env.WEBGUN_MAP = 'arena';
