// Supabase/PostgREST devuelve columnas `geography` como WKB hexadecimal,
// tanto en selects normales como en los payloads de Realtime. Esta función
// decodifica un WKB Point (little-endian, con o sin SRID) a {lat, lng}.
function parseWkbPoint(hex) {
  if (!hex) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  const vista = new DataView(bytes.buffer);
  const esLittleEndian = bytes[0] === 1;
  const tipo = vista.getUint32(1, esLittleEndian);
  const tieneSrid = (tipo & 0x20000000) !== 0;
  const offsetX = tieneSrid ? 9 : 5;
  const lng = vista.getFloat64(offsetX, esLittleEndian);
  const lat = vista.getFloat64(offsetX + 8, esLittleEndian);
  return { lat, lng };
}
