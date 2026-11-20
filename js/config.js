// Öffentliche Projektdaten. Der Publishable Key darf im Frontend stehen:
// Er erlaubt nichts, was die Regeln (RLS) in der Datenbank nicht erlauben.
// Geheime Schlüssel (service_role, secret keys) gehören NIE hierher.
export const CONFIG = Object.freeze({
  supabaseUrl: 'https://fptreysmjvmavdjirhnh.supabase.co',
  publishableKey: 'sb_publishable_1etJa2M1xd6AgWTp1ZI5GQ_i4SfcWiZ',
  appVersion: '0.4.0'
});
