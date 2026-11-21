import { useCallback, useEffect, useState } from 'react';
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
  Select,
} from '../ui';
import { apiJson } from '../../utils/api';

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pl-PL', {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
  } catch {
    return iso;
  }
}

export function SuperAdminPanel({ onBack }) {
  const [activeTab, setActiveTab] = useState('users'); // users | audit
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [newUsername, setNewUsername] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [tempSecret, setTempSecret] = useState(null); // { username, password, action }
  const [copied, setCopied] = useState(false);

  const [auditLogs, setAuditLogs] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditStatusFilter, setAuditStatusFilter] = useState('');
  const [auditActorFilter, setAuditActorFilter] = useState('');

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const { res, data } = await apiJson('/api/admin/users');
      if (res.ok && Array.isArray(data)) {
        setUsers(data);
      }
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const fetchAudit = useCallback(async () => {
    setLoadingAudit(true);
    try {
      const params = new URLSearchParams({ limit: '60', offset: '0' });
      if (auditStatusFilter) params.set('status', auditStatusFilter);
      if (auditActorFilter.trim()) params.set('actor', auditActorFilter.trim());
      const { res, data } = await apiJson(
        `/api/admin/audit-logs?${params.toString()}`
      );
      if (res.ok && Array.isArray(data.items)) {
        setAuditLogs(data.items);
        setAuditTotal(data.total || 0);
      }
    } finally {
      setLoadingAudit(false);
    }
  }, [auditStatusFilter, auditActorFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    if (activeTab === 'audit') {
      fetchAudit();
    }
  }, [activeTab, fetchAudit]);

  const handleCreateAdmin = async (e) => {
    e.preventDefault();
    setError('');
    setTempSecret(null);
    setCopied(false);
    setCreating(true);

    try {
      const { res, data } = await apiJson('/api/admin/users', {
        method: 'POST',
        body: { username: newUsername.trim() },
      });
      if (!res.ok) {
        setError(data.message || data.error || 'Nie udało się utworzyć admina.');
        return;
      }
      setNewUsername('');
      setTempSecret({
        username: data.user.username,
        password: data.temporaryPassword,
        action: 'Utworzono nowe konto administratora',
      });
      fetchUsers();
    } catch {
      setError('Błąd komunikacji z serwerem.');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleStatus = async (u) => {
    setError('');
    const nextActive = !u.isActive;
    const msg = nextActive
      ? `Aktywować konto "${u.username}"?`
      : `Dezaktywować konto "${u.username}"? Wszystkie aktywne sesje zostaną natychmiast przerwane.`;
    if (!confirm(msg)) return;

    const { res, data } = await apiJson(`/api/admin/users/${u.id}/status`, {
      method: 'PATCH',
      body: { isActive: nextActive },
    });
    if (!res.ok) {
      setError(data.message || data.error || 'Nie udało się zmienić statusu.');
      return;
    }
    fetchUsers();
  };

  const handleResetPassword = async (u) => {
    setError('');
    setTempSecret(null);
    setCopied(false);
    if (
      !confirm(
        `Zresetować hasło dla "${u.username}"? Zostanie wygenerowane nowe hasło tymczasowe, a aktywne sesje zostaną wylogowane.`
      )
    ) {
      return;
    }

    const { res, data } = await apiJson(
      `/api/admin/users/${u.id}/reset-password`,
      { method: 'POST' }
    );
    if (!res.ok) {
      setError(data.message || data.error || 'Nie udało się zresetować hasła.');
      return;
    }
    setTempSecret({
      username: data.username,
      password: data.temporaryPassword,
      action: 'Wygenerowano nowe hasło tymczasowe',
    });
    fetchUsers();
  };

  const handleDeleteUser = async (u) => {
    setError('');
    if (
      !confirm(
        `Czy na pewno trwale usunąć konto "${u.username}" oraz wszystkie jego prywatne quizy (${u.quizzesCount})? Tej operacji nie można cofnąć.`
      )
    ) {
      return;
    }
    const { res, data } = await apiJson(`/api/admin/users/${u.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      setError(data.message || data.error || 'Nie udało się usunąć konta.');
      return;
    }
    fetchUsers();
  };

  const handleCopyTempPassword = async () => {
    if (!tempSecret) return;
    try {
      await navigator.clipboard.writeText(tempSecret.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 animate-screen-enter">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={activeTab === 'users' ? 'default' : 'neutral'}
            size="sm"
            onClick={() => setActiveTab('users')}
          >
            Konta administratorów ({users.length})
          </Button>
          <Button
            type="button"
            variant={activeTab === 'audit' ? 'default' : 'neutral'}
            size="sm"
            onClick={() => setActiveTab('audit')}
          >
            Logi audytowe
          </Button>
        </div>
        <Button type="button" variant="neutral" size="sm" onClick={onBack}>
          ← Powrót do quizów
        </Button>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {tempSecret && (
        <Alert variant="warning" className="space-y-3">
          <div className="font-heading font-bold">
            {tempSecret.action}: <span>{tempSecret.username}</span>
          </div>
          <p className="text-xs">
            Przekaż poniższe hasło tymczasowe bezpiecznym kanałem. Zostanie ono
            wyświetlone <strong>tylko raz</strong> — przy pierwszym logowaniu
            użytkownik będzie musiał je zmienić.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-base border-2 border-border bg-secondary-background px-3 py-1.5 font-mono text-sm font-bold select-all">
              {tempSecret.password}
            </code>
            <Button
              type="button"
              size="sm"
              variant="neutral"
              onClick={handleCopyTempPassword}
            >
              {copied ? '✓ Skopiowano' : 'Kopiuj hasło'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="neutral"
              onClick={() => setTempSecret(null)}
            >
              Ukryj
            </Button>
          </div>
        </Alert>
      )}

      {activeTab === 'users' && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Dodaj nowego administratora</CardTitle>
              <CardDescription>
                Każdy nowy administrator otrzymuje losowe hasło tymczasowe oraz
                własną, odizolowaną bazę quizów. W systemie może istnieć
                wyłącznie jeden superadmin.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={handleCreateAdmin}
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
              >
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="new-admin-username">
                    Nazwa użytkownika (3–32 znaki: A-Z, 0-9, . _ -)
                  </Label>
                  <Input
                    id="new-admin-username"
                    type="text"
                    required
                    minLength={3}
                    maxLength={32}
                    pattern="[a-zA-Z0-9._-]+"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="np. prowadzacy_jan"
                    disabled={creating}
                  />
                </div>
                <Button type="submit" disabled={creating || !newUsername.trim()}>
                  {creating ? 'Tworzenie...' : '+ Utwórz admina'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lista kont</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingUsers && (
                <p className="text-sm text-foreground/75">Ładowanie kont...</p>
              )}
              {!loadingUsers &&
                users.map((u) => {
                  const isSuper = u.role === 'superadmin';
                  return (
                    <div
                      key={u.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-base border-2 border-border bg-background p-4"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-heading text-base font-bold">
                            {u.username}
                          </span>
                          <Badge variant={isSuper ? 'warning' : 'info'}>
                            {isSuper ? 'Superadmin (jedyny)' : 'Admin'}
                          </Badge>
                          <Badge variant={u.isActive ? 'default' : 'danger'}>
                            {u.isActive ? 'Aktywne' : 'Dezaktywowane'}
                          </Badge>
                          {u.mustChangePassword && (
                            <Badge variant="purple">Hasło tymczasowe</Badge>
                          )}
                        </div>
                        <div className="text-xs text-foreground/75">
                          Własne quizy: <strong>{u.quizzesCount}</strong> •
                          Ostatnie logowanie: {formatDateTime(u.lastLoginAt)} •
                          Utworzono: {formatDateTime(u.createdAt)}
                        </div>
                      </div>

                      {isSuper ? (
                        <Badge variant="neutral">Konto chronione (CLI)</Badge>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="neutral"
                            onClick={() => handleResetPassword(u)}
                          >
                            Reset hasła
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={u.isActive ? 'warning' : 'default'}
                            onClick={() => handleToggleStatus(u)}
                          >
                            {u.isActive ? 'Dezaktywuj' : 'Aktywuj'}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            onClick={() => handleDeleteUser(u)}
                          >
                            Usuń
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </CardContent>
          </Card>
        </>
      )}

      {activeTab === 'audit' && (
        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Dziennik zdarzeń bezpieczeństwa</CardTitle>
                <CardDescription>
                  Łącznie wpisów pasujących do filtra: {auditTotal}
                </CardDescription>
              </div>
              <Button
                type="button"
                size="sm"
                variant="neutral"
                onClick={fetchAudit}
                disabled={loadingAudit}
              >
                ↻ Odśwież
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="audit-actor">Filtruj po użytkowniku</Label>
                <Input
                  id="audit-actor"
                  value={auditActorFilter}
                  onChange={(e) => setAuditActorFilter(e.target.value)}
                  placeholder="login"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="audit-status">Status</Label>
                <Select
                  id="audit-status"
                  value={auditStatusFilter}
                  onChange={(e) => setAuditStatusFilter(e.target.value)}
                >
                  <option value="">Wszystkie</option>
                  <option value="SUCCESS">SUCCESS</option>
                  <option value="FAILURE">FAILURE</option>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingAudit ? (
              <p className="text-sm text-foreground/75">Ładowanie logów...</p>
            ) : auditLogs.length === 0 ? (
              <p className="text-sm text-foreground/75">
                Brak zdarzeń spełniających kryteria.
              </p>
            ) : (
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-base border-2 border-border bg-background p-3 text-xs space-y-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            log.status === 'SUCCESS' ? 'default' : 'danger'
                          }
                        >
                          {log.status}
                        </Badge>
                        <span className="font-mono font-bold">
                          {log.eventType}
                        </span>
                        {log.actorName && (
                          <Badge variant="neutral">{log.actorName}</Badge>
                        )}
                      </div>
                      <span className="text-foreground/70">
                        {formatDateTime(log.createdAt)}
                        {log.ipAddress ? ` • IP: ${log.ipAddress}` : ''}
                      </span>
                    </div>
                    {log.metadata && (
                      <div className="font-mono text-[11px] text-foreground/75 break-all">
                        {JSON.stringify(log.metadata)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}

