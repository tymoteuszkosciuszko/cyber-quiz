import { useCallback, useEffect, useRef, useState } from 'react';
import {
  browserSupportsWebAuthn,
  startRegistration,
} from '@simplewebauthn/browser';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '../ui';
import { apiJson, setCsrfToken } from '../../utils/api';
import {
  describeWebAuthnError,
  formatTransportsLabel,
} from '../../utils/webauthnErrors';

function formatShortDate(iso) {
  if (!iso) return 'nigdy';
  try {
    return new Date(iso).toLocaleString('pl-PL', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

export function AccountSecurityModal({
  user,
  onClose,
  onPasswordChanged,
  onLoggedOutAll,
  onMfaCountChanged,
}) {
  const isSuperAdmin = user.role === 'superadmin';
  const webAuthnSupported = browserSupportsWebAuthn();

  // Zmiana hasła
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Zarządzanie kluczami MFA (tylko superadmin)
  const [mfaCredentials, setMfaCredentials] = useState([]);
  const [mfaEnforcement, setMfaEnforcement] = useState(
    user.mfaEnforcement || 'required'
  );
  const [maxCredentials, setMaxCredentials] = useState(10);
  const [loadingMfa, setLoadingMfa] = useState(isSuperAdmin);
  const [mfaError, setMfaError] = useState('');
  const [mfaSuccess, setMfaSuccess] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [mfaPassword, setMfaPassword] = useState('');
  const [editingKeyId, setEditingKeyId] = useState(null);
  const [editingKeyName, setEditingKeyName] = useState('');
  const [deletingKeyId, setDeletingKeyId] = useState(null);
  const [deletePassword, setDeletePassword] = useState('');

  const onMfaCountChangedRef = useRef(onMfaCountChanged);
  useEffect(() => {
    onMfaCountChangedRef.current = onMfaCountChanged;
  }, [onMfaCountChanged]);

  const fetchMfaCredentials = useCallback(
    async ({ showLoading = false } = {}) => {
      if (!isSuperAdmin) return;
      if (showLoading) setLoadingMfa(true);
      try {
        const { res, data } = await apiJson('/api/auth/mfa/credentials');
        if (res.ok && Array.isArray(data.credentials)) {
          setMfaCredentials(data.credentials);
          if (data.enforcement) setMfaEnforcement(data.enforcement);
          if (data.maxCredentials) setMaxCredentials(data.maxCredentials);
          onMfaCountChangedRef.current?.(data.credentials.length);
        } else {
          setMfaError(
            data.message ||
              data.error ||
              'Nie udało się pobrać listy kluczy bezpieczeństwa.'
          );
        }
      } catch {
        setMfaError('Nie udało się pobrać listy kluczy bezpieczeństwa.');
      } finally {
        setLoadingMfa(false);
      }
    },
    [isSuperAdmin]
  );

  useEffect(() => {
    fetchMfaCredentials({ showLoading: true });
  }, [fetchMfaCredentials]);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword.length < 12) {
      setError('Nowe hasło musi mieć co najmniej 12 znaków.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Powtórzone hasło nie zgadza się z nowym hasłem.');
      return;
    }

    setSubmitting(true);
    try {
      const { res, data } = await apiJson('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });

      if (!res.ok) {
        setError(data.message || data.error || 'Nie udało się zmienić hasła.');
        return;
      }

      setCsrfToken(data.csrfToken);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess(
        'Hasło zostało zmienione. Wszystkie pozostałe sesje zostały wylogowane.'
      );
      onPasswordChanged?.(data.user);
    } catch {
      setError('Błąd komunikacji z serwerem.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddMfaKey = async (e) => {
    e.preventDefault();
    setMfaError('');
    setMfaSuccess('');

    const trimmedName = newKeyName.trim();
    if (!trimmedName) {
      setMfaError('Podaj nazwę klucza bezpieczeństwa.');
      return;
    }
    if (!mfaPassword) {
      setMfaError('Podaj aktualne hasło, aby dodać nowy klucz.');
      return;
    }

    setMfaBusy(true);
    try {
      const { res: optRes, data: optData } = await apiJson(
        '/api/auth/mfa/register/options',
        {
          method: 'POST',
          body: { currentPassword: mfaPassword },
        }
      );

      if (!optRes.ok || !optData.options) {
        setMfaError(
          optData.message ||
            optData.error ||
            'Nie udało się rozpocząć rejestracji klucza.'
        );
        return;
      }

      let attestation;
      try {
        attestation = await startRegistration({ optionsJSON: optData.options });
      } catch (webAuthnErr) {
        setMfaError(describeWebAuthnError(webAuthnErr));
        return;
      }

      const { res: verRes, data: verData } = await apiJson(
        '/api/auth/mfa/register/verify',
        {
          method: 'POST',
          body: { name: trimmedName, response: attestation },
        }
      );

      if (!verRes.ok) {
        setMfaError(
          verData.message ||
            verData.error ||
            'Rejestracja klucza bezpieczeństwa nie powiodła się.'
        );
        return;
      }

      setNewKeyName('');
      setMfaPassword('');
      setMfaSuccess(`Dodano nowy klucz bezpieczeństwa: "${verData.credential.name}".`);
      fetchMfaCredentials();
    } catch {
      setMfaError('Błąd komunikacji z serwerem.');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleSaveRename = async (credId) => {
    setMfaError('');
    setMfaSuccess('');
    const trimmed = editingKeyName.trim();
    if (!trimmed) {
      setMfaError('Nazwa klucza nie może być pusta.');
      return;
    }

    setMfaBusy(true);
    try {
      const { res, data } = await apiJson(`/api/auth/mfa/credentials/${credId}`, {
        method: 'PATCH',
        body: { name: trimmed },
      });
      if (!res.ok) {
        setMfaError(data.message || data.error || 'Nie udało się zmienić nazwy.');
        return;
      }
      setEditingKeyId(null);
      setEditingKeyName('');
      setMfaSuccess('Zmieniono nazwę klucza.');
      fetchMfaCredentials();
    } catch {
      setMfaError('Błąd komunikacji z serwerem.');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleDeleteMfaKey = async (cred) => {
    setMfaError('');
    setMfaSuccess('');
    if (!deletePassword) {
      setMfaError('Podaj aktualne hasło, aby usunąć klucz.');
      return;
    }

    setMfaBusy(true);
    try {
      const { res, data } = await apiJson(`/api/auth/mfa/credentials/${cred.id}`, {
        method: 'DELETE',
        body: { currentPassword: deletePassword },
      });
      if (!res.ok) {
        setMfaError(data.message || data.error || 'Nie udało się usunąć klucza.');
        return;
      }
      setDeletingKeyId(null);
      setDeletePassword('');
      setMfaSuccess(`Usunięto klucz "${cred.name}".`);
      fetchMfaCredentials();
    } catch {
      setMfaError('Błąd komunikacji z serwerem.');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleLogoutAll = async () => {
    if (
      !confirm(
        'Wylogować konto ze wszystkich urządzeń (włącznie z bieżącą kartą)?'
      )
    ) {
      return;
    }
    try {
      await apiJson('/api/auth/logout-all', { method: 'POST' });
    } finally {
      setCsrfToken(null);
      onLoggedOutAll?.();
    }
  };

  const isLastProtectedKey =
    mfaEnforcement === 'required' && mfaCredentials.length <= 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Bezpieczeństwo konta"
    >
      <Card
        className={`w-full ${isSuperAdmin ? 'max-w-lg' : 'max-w-md'} max-h-[90vh] overflow-y-auto`}
      >
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <span>Bezpieczeństwo konta</span>
              <Badge variant={isSuperAdmin ? 'warning' : 'neutral'}>
                {isSuperAdmin ? 'Superadmin' : 'Admin'}
              </Badge>
            </CardTitle>
            <CardDescription>Zalogowano jako: {user.username}</CardDescription>
          </div>
          <Button type="button" variant="neutral" size="sm" onClick={onClose}>
            ✕
          </Button>
        </CardHeader>

        <CardContent className="space-y-6">
          {isSuperAdmin && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-heading text-sm font-bold uppercase tracking-wide">
                  Klucze bezpieczeństwa (MFA / FIDO2)
                </h3>
                <Badge variant={mfaCredentials.length > 0 ? 'default' : 'danger'}>
                  {mfaCredentials.length} / {maxCredentials}
                </Badge>
              </div>

              <p className="text-xs text-foreground/75">
                Logowanie superadmina wymaga potwierdzenia zarejestrowanym kluczem
                z PIN-em FIDO2 lub biometrią (np. YubiKey, inny klucz sprzętowy,
                Touch ID / Windows Hello).
              </p>

              {mfaCredentials.length === 1 && (
                <Alert variant="warning" className="text-xs">
                  Masz zarejestrowany tylko <strong>1 klucz</strong>. Dodaj drugi
                  klucz zapasowy (np. drugi YubiKey lub Touch ID), aby uniknąć
                  konieczności awaryjnego resetu MFA przez SSH.
                </Alert>
              )}

              {mfaError && <Alert variant="danger">{mfaError}</Alert>}
              {mfaSuccess && <Alert variant="default">{mfaSuccess}</Alert>}

              {loadingMfa ? (
                <p className="text-xs text-foreground/75">Ładowanie kluczy...</p>
              ) : mfaCredentials.length === 0 ? (
                <p className="text-xs text-foreground/75">
                  Brak zarejestrowanych kluczy bezpieczeństwa.
                </p>
              ) : (
                <div className="space-y-2">
                  {mfaCredentials.map((cred) => {
                    const isEditing = editingKeyId === cred.id;
                    const isDeleting = deletingKeyId === cred.id;
                    return (
                      <div
                        key={cred.id}
                        className="rounded-base border-2 border-border bg-background p-3 space-y-2"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="space-y-0.5 min-w-0">
                            {isEditing ? (
                              <div className="flex items-center gap-2">
                                <Input
                                  type="text"
                                  value={editingKeyName}
                                  maxLength={64}
                                  onChange={(e) => setEditingKeyName(e.target.value)}
                                  disabled={mfaBusy}
                                  className="h-8 text-xs"
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={mfaBusy || !editingKeyName.trim()}
                                  onClick={() => handleSaveRename(cred.id)}
                                >
                                  Zapisz
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="neutral"
                                  disabled={mfaBusy}
                                  onClick={() => {
                                    setEditingKeyId(null);
                                    setEditingKeyName('');
                                  }}
                                >
                                  Anuluj
                                </Button>
                              </div>
                            ) : (
                              <div className="font-heading text-sm font-bold break-words">
                                {cred.name}
                              </div>
                            )}
                            <div className="text-[11px] text-foreground/75">
                              {formatTransportsLabel(cred.transports, cred.deviceType)}
                            </div>
                            <div className="text-[11px] text-foreground/70">
                              Dodano: {formatShortDate(cred.createdAt)} • Ostatnio
                              użyty: {formatShortDate(cred.lastUsedAt)}
                            </div>
                          </div>

                          {!isEditing && !isDeleting && (
                            <div className="flex items-center gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant="neutral"
                                disabled={mfaBusy}
                                onClick={() => {
                                  setEditingKeyId(cred.id);
                                  setEditingKeyName(cred.name);
                                  setDeletingKeyId(null);
                                  setDeletePassword('');
                                }}
                              >
                                Zmień nazwę
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="danger"
                                disabled={mfaBusy || isLastProtectedKey}
                                title={
                                  isLastProtectedKey
                                    ? 'Dodaj drugi klucz przed usunięciem ostatniego'
                                    : 'Usuń klucz'
                                }
                                onClick={() => {
                                  setDeletingKeyId(cred.id);
                                  setDeletePassword('');
                                  setEditingKeyId(null);
                                }}
                              >
                                Usuń
                              </Button>
                            </div>
                          )}
                        </div>

                        {isDeleting && (
                          <div className="border-t border-border/50 pt-2 space-y-2">
                            <Label
                              htmlFor={`del-pwd-${cred.id}`}
                              className="text-xs"
                            >
                              Potwierdź aktualne hasło, aby usunąć klucz „{cred.name}”:
                            </Label>
                            <div className="flex flex-wrap items-center gap-2">
                              <Input
                                id={`del-pwd-${cred.id}`}
                                type="password"
                                autoComplete="current-password"
                                value={deletePassword}
                                onChange={(e) => setDeletePassword(e.target.value)}
                                disabled={mfaBusy}
                                className="h-8 flex-1 text-xs"
                                placeholder="Aktualne hasło"
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="danger"
                                disabled={mfaBusy || !deletePassword}
                                onClick={() => handleDeleteMfaKey(cred)}
                              >
                                Potwierdź usunięcie
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="neutral"
                                disabled={mfaBusy}
                                onClick={() => {
                                  setDeletingKeyId(null);
                                  setDeletePassword('');
                                }}
                              >
                                Anuluj
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {mfaCredentials.length < maxCredentials && (
                <form
                  onSubmit={handleAddMfaKey}
                  className="rounded-base border-2 border-border bg-secondary-background p-3 space-y-2.5"
                >
                  <div className="font-heading text-xs font-bold uppercase tracking-wide">
                    Dodaj nowy klucz (YubiKey / Touch ID / FIDO2)
                  </div>

                  {!webAuthnSupported && (
                    <Alert variant="danger" className="text-xs">
                      Przeglądarka nie obsługuje WebAuthn dla bieżącego adresu.
                    </Alert>
                  )}

                  <div className="space-y-1">
                    <Label htmlFor="mfa-new-key-name">Nazwa klucza</Label>
                    <Input
                      id="mfa-new-key-name"
                      type="text"
                      required
                      minLength={1}
                      maxLength={64}
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="np. YubiKey 5C NFC / Touch ID MacBook"
                      disabled={mfaBusy || !webAuthnSupported}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="mfa-reauth-pwd">
                      Aktualne hasło (potwierdzenie tożsamości)
                    </Label>
                    <Input
                      id="mfa-reauth-pwd"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={mfaPassword}
                      onChange={(e) => setMfaPassword(e.target.value)}
                      disabled={mfaBusy || !webAuthnSupported}
                    />
                  </div>

                  <Button
                    type="submit"
                    size="sm"
                    className="w-full"
                    disabled={
                      mfaBusy ||
                      !webAuthnSupported ||
                      !newKeyName.trim() ||
                      !mfaPassword
                    }
                  >
                    {mfaBusy
                      ? 'Oczekiwanie na klucz...'
                      : '+ Zarejestruj nowy klucz'}
                  </Button>
                </form>
              )}
            </div>
          )}

          <form
            onSubmit={handleChangePassword}
            className={`${isSuperAdmin ? 'border-t-2 border-border pt-4 ' : ''}space-y-3`}
          >
            <h3 className="font-heading text-sm font-bold uppercase tracking-wide">
              Zmiana hasła
            </h3>

            {error && <Alert variant="danger">{error}</Alert>}
            {success && <Alert variant="default">{success}</Alert>}

            <div className="space-y-1">
              <Label htmlFor="sec-current-pwd">Aktualne hasło</Label>
              <Input
                id="sec-current-pwd"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="sec-new-pwd">Nowe hasło (min. 12 znaków)</Label>
              <Input
                id="sec-new-pwd"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="sec-confirm-pwd">Powtórz nowe hasło</Label>
              <Input
                id="sec-confirm-pwd"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={submitting}
              />
            </div>

            <Button
              type="submit"
              size="sm"
              className="w-full"
              disabled={submitting}
            >
              {submitting ? 'Zapisywanie...' : 'Zmień hasło'}
            </Button>
          </form>

          <div className="border-t-2 border-border pt-4 space-y-2">
            <h3 className="font-heading text-sm font-bold uppercase tracking-wide">
              Aktywne sesje
            </h3>
            <p className="text-xs text-foreground/75">
              Natychmiast unieważnia wszystkie aktywne sesje przeglądarkowe i
              WebSocket dla tego konta.
            </p>
            <Button
              type="button"
              variant="danger"
              size="sm"
              className="w-full"
              onClick={handleLogoutAll}
            >
              Wyloguj ze wszystkich urządzeń
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
