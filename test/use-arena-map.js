// Imported first by the tests, before anything loads shared/constants.js or the server: their positions
// ("center box", "corner tower", the dummy at (0, 10)) are written against the arena layout, not the real map.
process.env.WEBGUN_MAP = 'arena';
// No AI bots by default: a lone test player would otherwise get shot at. Bot tests ask for them per room.
process.env.BOTS = '0';
