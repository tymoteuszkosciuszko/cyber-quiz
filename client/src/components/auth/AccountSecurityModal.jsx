import { useState } from 'react';
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

export function AccountSecurityModal({
  user,
  onClose,
  onPasswordChanged,
  onLoggedOutAll,
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Bezpieczeństwo konta"
    >
      <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <span>Bezpieczeństwo konta</span>
              <Badge variant={user.role === 'superadmin' ? 'warning' : 'neutral'}>
                {user.role === 'superadmin' ? 'Superadmin' : 'Admin'}
              </Badge>
            </CardTitle>
            <CardDescription>Zalogowano jako: {user.username}</CardDescription>
          </div>
          <Button type="button" variant="neutral" size="sm" onClick={onClose}>
            ✕
          </Button>
        </CardHeader>

        <CardContent className="space-y-6">
          <form onSubmit={handleChangePassword} className="space-y-3">
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

