import { useState } from 'react';
import {
  Alert,
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

export function ForcePasswordChangeView({ user, onPasswordChanged, onLogout }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

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
      onPasswordChanged({
        status: data.status || 'AUTHENTICATED',
        user: data.user,
      });
    } catch {
      setError('Błąd komunikacji z serwerem.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-md animate-screen-enter">
      <Card>
        <CardHeader>
          <CardTitle>Wymagana zmiana hasła</CardTitle>
          <CardDescription>
            Konto <strong>{user.username}</strong> używa hasła tymczasowego.
            Ustaw własne silne hasło (min. 12 znaków), aby uzyskać dostęp do
            panelu.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <Alert variant="danger">{error}</Alert>}

            <div className="space-y-2">
              <Label htmlFor="force-current-pwd">Hasło tymczasowe</Label>
              <Input
                id="force-current-pwd"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="force-new-pwd">Nowe hasło (min. 12 znaków)</Label>
              <Input
                id="force-new-pwd"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="np. długie zdanie lub hasło z menedżera"
                disabled={submitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="force-confirm-pwd">Powtórz nowe hasło</Label>
              <Input
                id="force-confirm-pwd"
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

            <div className="flex flex-col gap-2 pt-2">
              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={submitting}
              >
                {submitting ? 'Zapisywanie...' : 'Ustaw nowe hasło i wejdź'}
              </Button>
              <Button
                type="button"
                variant="neutral"
                size="sm"
                onClick={onLogout}
                disabled={submitting}
              >
                Wyloguj
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

