import { useState } from 'react';
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
import { describeWebAuthnError } from '../../utils/webauthnErrors';

export function MfaEnrollmentView({ user, onCompleted, onLogout, onSessionExpired }) {
  const [keyName, setKeyName] = useState('YubiKey główny');
  const [backupKeyName, setBackupKeyName] = useState('Klucz zapasowy (np. Touch ID)');
  const [currentPassword, setCurrentPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [enrolledAuthResult, setEnrolledAuthResult] = useState(null);
  const [registeredKeys, setRegisteredKeys] = useState([]);

  const supported = browserSupportsWebAuthn();

  const handleRegisterFirstKey = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const trimmedName = keyName.trim();
    if (!trimmedName) {
      setError('Podaj nazwę klucza bezpieczeństwa.');
      return;
    }

    setSubmitting(true);
    try {
      const { res: optRes, data: optData } = await apiJson(
        '/api/auth/mfa/register/options',
        {
          method: 'POST',
          body: {},
          skipAuthRedirect: true,
        }
      );

      if (optRes.status === 401) {
        onSessionExpired?.();
        return;
      }

      if (!optRes.ok || !optData.options) {
        setError(
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
        setError(describeWebAuthnError(webAuthnErr));
        return;
      }

      const { res: verRes, data: verData } = await apiJson(
        '/api/auth/mfa/register/verify',
        {
          method: 'POST',
          body: { name: trimmedName, response: attestation },
          skipAuthRedirect: true,
        }
      );

      if (verRes.status === 401) {
        onSessionExpired?.();
        return;
      }

      if (!verRes.ok) {
        setError(
          verData.message ||
            verData.error ||
            'Rejestracja klucza bezpieczeństwa nie powiodła się.'
        );
        return;
      }

      setCsrfToken(verData.csrfToken);
      setRegisteredKeys([verData.credential]);
      setEnrolledAuthResult({ status: verData.status, user: verData.user });
      setSuccess(
        `Zarejestrowano klucz "${verData.credential.name}". Zalecamy od razu dodać drugi klucz zapasowy (np. drugi YubiKey lub Touch ID).`
      );
    } catch {
      setError('Błąd komunikacji z serwerem.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterBackupKey = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const trimmedName = backupKeyName.trim();
    if (!trimmedName) {
      setError('Podaj nazwę klucza zapasowego.');
      return;
    }
    if (!currentPassword) {
      setError('Podaj aktualne hasło, aby potwierdzić dodanie kolejnego klucza.');
      return;
    }

    setSubmitting(true);
    try {
      const { res: optRes, data: optData } = await apiJson(
        '/api/auth/mfa/register/options',
        {
          method: 'POST',
          body: { currentPassword },
        }
      );

      if (!optRes.ok || !optData.options) {
        setError(
          optData.message ||
            optData.error ||
            'Nie udało się rozpocząć rejestracji klucza zapasowego.'
        );
        return;
      }

      let attestation;
      try {
        attestation = await startRegistration({ optionsJSON: optData.options });
      } catch (webAuthnErr) {
        setError(describeWebAuthnError(webAuthnErr));
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
        setError(
          verData.message ||
            verData.error ||
            'Nie udało się zapisać klucza zapasowego.'
        );
        return;
      }

      setRegisteredKeys((prev) => [...prev, verData.credential]);
      setEnrolledAuthResult((prev) =>
        prev
          ? {
              ...prev,
              user: {
                ...prev.user,
                mfaCredentialsCount: verData.mfaCredentialsCount,
              },
            }
          : prev
      );
      setBackupKeyName('');
      setCurrentPassword('');
      setSuccess(
        `Dodano klucz zapasowy "${verData.credential.name}". Masz teraz ${verData.mfaCredentialsCount} zarejestrowane klucze.`
      );
    } catch {
      setError('Błąd komunikacji z serwerem.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-lg animate-screen-enter">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Konfiguracja MFA (wymagana)</CardTitle>
            <Badge variant="warning">Superadmin</Badge>
          </div>
          <CardDescription>
            Konto <strong>{user.username}</strong> wymaga zarejestrowania co
            najmniej jednego klucza bezpieczeństwa FIDO2 (np. YubiKey z PIN-em
            FIDO2, inny klucz sprzętowy lub Touch ID / Windows Hello).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!supported && (
            <Alert variant="danger">
              Twoja przeglądarka nie obsługuje WebAuthn / FIDO2 lub połączenie
              nie jest bezpieczne (wymagany HTTPS albo http://localhost).
            </Alert>
          )}

          {error && <Alert variant="danger">{error}</Alert>}
          {success && <Alert variant="default">{success}</Alert>}

          {!enrolledAuthResult ? (
            <form onSubmit={handleRegisterFirstKey} className="space-y-4">
              <div className="rounded-base border-2 border-border bg-background p-4 text-xs space-y-1.5 text-foreground/85">
                <div className="font-heading text-sm font-bold text-foreground">
                  Wymagania bezpieczeństwa:
                </div>
                <p>
                  • Klucz musi posiadać skonfigurowany <strong>PIN FIDO2</strong>{' '}
                  lub biometrię (Touch ID / Windows Hello).
                </p>
                <p>
                  • Po rejestracji pierwszego klucza możesz od razu dodać kolejne
                  klucze zapasowe.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="enroll-key-name">Nazwa pierwszego klucza</Label>
                <Input
                  id="enroll-key-name"
                  type="text"
                  required
                  minLength={1}
                  maxLength={64}
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="np. YubiKey 5C NFC"
                  disabled={submitting || !supported}
                />
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={submitting || !supported || !keyName.trim()}
                >
                  {submitting
                    ? 'Oczekiwanie na klucz...'
                    : 'Zarejestruj pierwszy klucz bezpieczeństwa'}
                </Button>
                <Button
                  type="button"
                  variant="neutral"
                  size="sm"
                  disabled={submitting}
                  onClick={onLogout}
                >
                  Wyloguj
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="font-heading text-xs font-bold uppercase tracking-wide">
                  Zarejestrowane klucze ({registeredKeys.length})
                </div>
                {registeredKeys.map((k) => (
                  <div
                    key={k.id}
                    className="flex items-center justify-between rounded-base border-2 border-border bg-background px-3 py-2 text-sm"
                  >
                    <span className="font-heading font-bold">{k.name}</span>
                    <Badge variant="default">Aktywny</Badge>
                  </div>
                ))}
              </div>

              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={submitting}
                onClick={() => onCompleted(enrolledAuthResult)}
              >
                Przejdź do panelu administracyjnego →
              </Button>

              <form
                onSubmit={handleRegisterBackupKey}
                className="border-t-2 border-border pt-4 space-y-3"
              >
                <div className="font-heading text-sm font-bold">
                  Dodaj klucz zapasowy (opcjonalnie, zalecane)
                </div>
                <p className="text-xs text-foreground/75">
                  Możesz dodać drugi YubiKey, inny klucz sprzętowy albo Touch ID
                  / Windows Hello, aby uniknąć utraty dostępu w razie zgubienia
                  klucza głównego.
                </p>

                <div className="space-y-1">
                  <Label htmlFor="enroll-backup-name">Nazwa klucza zapasowego</Label>
                  <Input
                    id="enroll-backup-name"
                    type="text"
                    required
                    minLength={1}
                    maxLength={64}
                    value={backupKeyName}
                    onChange={(e) => setBackupKeyName(e.target.value)}
                    placeholder="np. MacBook Touch ID / YubiKey zapasowy"
                    disabled={submitting}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="enroll-backup-pwd">
                    Potwierdź aktualne hasło
                  </Label>
                  <Input
                    id="enroll-backup-pwd"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    disabled={submitting}
                  />
                </div>

                <Button
                  type="submit"
                  variant="neutral"
                  size="sm"
                  className="w-full"
                  disabled={submitting || !backupKeyName.trim() || !currentPassword}
                >
                  {submitting
                    ? 'Oczekiwanie na klucz...'
                    : '+ Zarejestruj klucz zapasowy'}
                </Button>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

