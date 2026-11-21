import { useState } from 'react';
import {
  browserSupportsWebAuthn,
  startAuthentication,
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
} from '../ui';
import { apiJson, setCsrfToken } from '../../utils/api';
import { describeWebAuthnError } from '../../utils/webauthnErrors';

export function MfaVerifyView({ user, onAuthenticated, onLogout, onSessionExpired }) {
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const supported = browserSupportsWebAuthn();

  const handleVerify = async () => {
    setError('');
    setVerifying(true);

    try {
      const { res: optRes, data: optData } = await apiJson(
        '/api/auth/mfa/login/options',
        {
          method: 'POST',
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
            'Nie udało się rozpocząć weryfikacji klucza.'
        );
        return;
      }

      let assertion;
      try {
        assertion = await startAuthentication({ optionsJSON: optData.options });
      } catch (webAuthnErr) {
        setError(describeWebAuthnError(webAuthnErr));
        return;
      }

      const { res: verRes, data: verData } = await apiJson(
        '/api/auth/mfa/login/verify',
        {
          method: 'POST',
          body: { response: assertion },
          skipAuthRedirect: true,
        }
      );

      if (verRes.status === 401 && verData.error === 'MFA_SESSION_EXHAUSTED') {
        setError(
          verData.message ||
            'Przekroczono limit nieudanych prób MFA. Zaloguj się ponownie.'
        );
        onSessionExpired?.();
        return;
      }

      if (verRes.status === 401 && verData.error === 'SESSION_EXPIRED') {
        onSessionExpired?.();
        return;
      }

      if (!verRes.ok) {
        setError(
          verData.message ||
            verData.error ||
            'Weryfikacja klucza bezpieczeństwa nie powiodła się.'
        );
        return;
      }

      setCsrfToken(verData.csrfToken);
      onAuthenticated({ status: verData.status, user: verData.user });
    } catch {
      setError('Błąd komunikacji z serwerem. Spróbuj ponownie.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-md animate-screen-enter">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Weryfikacja MFA (FIDO2)</CardTitle>
            <Badge variant="warning">Superadmin</Badge>
          </div>
          <CardDescription>
            Konto <strong>{user.username}</strong> wymaga potwierdzenia
            zarejestrowanym kluczem bezpieczeństwa (YubiKey z PIN-em FIDO2 lub
            innym zarejestrowanym kluczem, np. Touch ID).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!supported && (
            <Alert variant="danger">
              Twoja przeglądarka nie obsługuje WebAuthn / FIDO2 lub strona nie
              jest otwarta przez bezpieczne połączenie (HTTPS / localhost).
            </Alert>
          )}

          {error && <Alert variant="danger">{error}</Alert>}

          <div className="rounded-base border-2 border-border bg-background p-4 text-sm space-y-2">
            <div className="font-heading font-bold">Instrukcja:</div>
            <ol className="list-decimal list-inside space-y-1 text-xs text-foreground/85">
              <li>Podłącz YubiKey (USB / NFC) lub przygotuj Touch ID / klucz zapasowy.</li>
              <li>Kliknij przycisk poniżej, wpisz PIN FIDO2 (lub użyj biometrii).</li>
              <li>Dotknij klucza sprzętowego, gdy zacznie migać.</li>
            </ol>
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={!supported || verifying}
              onClick={handleVerify}
            >
              {verifying
                ? 'Oczekiwanie na klucz bezpieczeństwa...'
                : 'Zweryfikuj klucz bezpieczeństwa'}
            </Button>
            <Button
              type="button"
              variant="neutral"
              size="sm"
              disabled={verifying}
              onClick={onLogout}
            >
              Anuluj i wróć do logowania
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

