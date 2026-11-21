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

export function LoginView({ onAuthenticated }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const { res, data } = await apiJson('/api/auth/login', {
        method: 'POST',
        body: { username: username.trim(), password },
        skipAuthRedirect: true,
      });

      if (!res.ok) {
        if (res.status === 429) {
          setError(
            'Zbyt wiele nieudanych prób logowania. Odczekaj chwilę i spróbuj ponownie.'
          );
        } else {
          setError('Nieprawidłowa nazwa użytkownika lub hasło.');
        }
        setPassword('');
        return;
      }

      setCsrfToken(data.csrfToken);
      setPassword('');
      onAuthenticated({
        status: data.status || 'AUTHENTICATED',
        user: data.user,
      });
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-md animate-screen-enter">
      <Card>
        <CardHeader>
          <CardTitle>Logowanie do Panelu Admina</CardTitle>
          <CardDescription>
            Zaloguj się kontem administratora lub superadmina, aby zarządzać
            quizami i prowadzić sesje na żywo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <Alert variant="danger">{error}</Alert>}

            <div className="space-y-2">
              <Label htmlFor="login-username">Nazwa użytkownika</Label>
              <Input
                id="login-username"
                name="username"
                type="text"
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="login"
                disabled={submitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="login-password">Hasło</Label>
              <Input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                disabled={submitting}
              />
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={submitting || !username.trim() || !password}
            >
              {submitting ? 'Logowanie...' : 'Zaloguj się'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

