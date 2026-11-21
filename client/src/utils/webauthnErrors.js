export function describeWebAuthnError(err) {
  if (!err) return 'Operacja z kluczem bezpieczeństwa nie powiodła się.';
  const name = err.name || '';
  const code = err.code || '';
  const msg = String(err.message || '');

  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || name === 'InvalidStateError') {
    return 'Ten klucz bezpieczeństwa jest już zarejestrowany dla tego konta.';
  }
  if (name === 'NotAllowedError') {
    return 'Operacja została anulowana, przekroczono limit czasu lub nie podano poprawnego PIN-u FIDO2 / biometrii.';
  }
  if (name === 'SecurityError') {
    return 'Przeglądarka zablokowała WebAuthn dla tego adresu. Użyj połączenia HTTPS (lub http://localhost w trybie deweloperskim).';
  }
  if (name === 'NotSupportedError' || code === 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY') {
    return 'Ten klucz lub przeglądarka nie obsługuje wymaganego algorytmu albo weryfikacji PIN FIDO2.';
  }
  if (name === 'AbortError') {
    return 'Operacja uwierzytelniania została przerwana.';
  }
  if (msg) {
    return msg;
  }
  return 'Nie udało się porozumieć z kluczem bezpieczeństwa.';
}

export function formatTransportsLabel(transports = [], deviceType = 'singleDevice') {
  const list = Array.isArray(transports) ? transports : [];
  if (list.includes('internal')) {
    return 'Platformowy (np. Touch ID / Windows Hello)';
  }
  const labels = [];
  if (list.includes('usb')) labels.push('USB');
  if (list.includes('nfc')) labels.push('NFC');
  if (list.includes('ble')) labels.push('Bluetooth');
  if (list.includes('hybrid')) labels.push('Hybrid / Telefon');
  if (labels.length > 0) {
    return `Klucz sprzętowy (${labels.join(' / ')})`;
  }
  return deviceType === 'multiDevice'
    ? 'Klucz wielourządzeniowy (Passkey)'
    : 'Klucz bezpieczeństwa FIDO2';
}

