'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

type User = {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'USER';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lineCode: string | null;
  lineName: string | null;
};

type ProductionLine = { lineCode: string; name: string };
type UsersResponse = { users: User[]; total: number; page: number; pageSize: number };

export default function UserManagement({
  initialData,
  currentUserId,
  lines,
}: {
  initialData: UsersResponse;
  currentUserId: string;
  lines: ProductionLine[];
}) {
  const router = useRouter();
  const pageSize = 20;
  const [users, setUsers] = useState<User[]>(initialData.users);
  const [total, setTotal] = useState(initialData.total);
  const [page, setPage] = useState(initialData.page);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'' | User['role']>('');
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'inactive'>('');
  const [editing, setEditing] = useState<User | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<User['role']>('USER');
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState('');
  const [lineCode, setLineCode] = useState(lines[0]?.lineCode ?? '');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function loadUsers(
    searchTerm = search,
    pageNumber = page,
    nextRole = roleFilter,
    nextStatus = statusFilter,
  ) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        search: searchTerm,
        page: String(pageNumber),
        pageSize: String(pageSize),
        role: nextRole,
        status: nextStatus,
      });
      const response = await fetch(`/api/admin/users?${params}`);
      if (response.status === 401) router.replace('/login');
      const result = await response.json() as UsersResponse & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Gagal memuat pengguna.');
      setUsers(result.users);
      setTotal(result.total);
      setPage(result.page);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Gagal memuat pengguna.');
    } finally {
      setLoading(false);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSearch = searchInput.trim();
    setSearch(nextSearch);
    void loadUsers(nextSearch, 1);
  }

  function updateRoleFilter(value: '' | User['role']) {
    setRoleFilter(value);
    void loadUsers(search, 1, value, statusFilter);
  }

  function updateStatusFilter(value: '' | 'active' | 'inactive') {
    setStatusFilter(value);
    void loadUsers(search, 1, roleFilter, value);
  }

  function startCreate() {
    setEditing(null);
    setFormOpen(true);
    setName('');
    setEmail('');
    setRole('USER');
    setLineCode(lines[0]?.lineCode ?? '');
    setIsActive(true);
    setPassword('');
    setNotice('');
    setError('');
  }

  function startEdit(user: User) {
    setEditing(user);
    setFormOpen(true);
    setName(user.name);
    setEmail(user.email);
    setRole(user.role);
    setLineCode(user.lineCode ?? lines[0]?.lineCode ?? '');
    setIsActive(user.isActive);
    setPassword('');
    setNotice('');
    setError('');
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const body: Record<string, string | boolean | null> = {
        name,
        email,
        role,
        isActive,
        lineCode: role === 'ADMIN' ? null : lineCode,
      };
      if (password) body.password = password;
      else if (!editing) throw new Error('Password wajib diisi saat membuat pengguna.');
      const response = await fetch(editing ? `/api/admin/users/${editing.id}` : '/api/admin/users', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.status === 401) router.replace('/login');
      if (response.status === 401 || response.status === 403) {
        throw new Error('Sesi berakhir atau akses tidak lagi diizinkan.');
      }
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Gagal menyimpan pengguna.');
      const updated = result as { reauthenticate?: boolean };
      if (updated.reauthenticate) {
        router.replace('/login');
        router.refresh();
        return;
      }
      setNotice(editing ? 'Pengguna berhasil diperbarui.' : 'Pengguna berhasil dibuat.');
      setEditing(null);
      setFormOpen(false);
      setName('');
      setEmail('');
      setPassword('');
      await loadUsers();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Gagal menyimpan pengguna.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(user: User) {
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      if (response.status === 401) router.replace('/login');
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Gagal mengubah status akun.');
      setNotice('Status akun berhasil diperbarui.');
      await loadUsers();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Gagal mengubah status akun.');
    }
  }

  async function removeUser(user: User) {
    if (!window.confirm(`Hapus akun ${user.name} (${user.email})? Tindakan ini tidak dapat dibatalkan.`)) return;
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      if (response.status === 401) router.replace('/login');
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Gagal menghapus pengguna.');
      setNotice('Pengguna berhasil dihapus.');
      await loadUsers();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Gagal menghapus pengguna.');
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="users-page">
      <header className="users-header">
        <div>
          <p className="users-eyebrow">ADMINISTRASI</p>
          <h1>Manajemen Pengguna</h1>
          <p>Kelola akun dan peran akses sistem.</p>
        </div>
        <button type="button" className="users-primary" onClick={startCreate}>Tambah Pengguna</button>
      </header>

      {(notice || error) && (
        <p className={error ? 'users-message users-message-error' : 'users-message'} role="status">
          {error || notice}
        </p>
      )}

      <section className="users-panel">
        <form className="users-search" onSubmit={submitSearch}>
          <label htmlFor="user-search">Cari nama atau email</label>
          <input id="user-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} maxLength={100} />
          <label htmlFor="user-role-filter">Role
            <select id="user-role-filter" value={roleFilter} onChange={(event) => updateRoleFilter(event.target.value as '' | User['role'])}>
              <option value="">Semua role</option><option value="ADMIN">ADMIN</option><option value="USER">USER</option>
            </select>
          </label>
          <label htmlFor="user-status-filter">Status
            <select id="user-status-filter" value={statusFilter} onChange={(event) => updateStatusFilter(event.target.value as '' | 'active' | 'inactive')}>
              <option value="">Semua status</option><option value="active">Aktif</option><option value="inactive">Nonaktif</option>
            </select>
          </label>
          <button type="submit">Cari</button>
        </form>

        {loading ? <p className="users-empty">Memuat pengguna...</p> : (
          <div className="users-table-wrap">
            <table className="users-table">
              <thead>
                <tr><th>Nama</th><th>Email</th><th>Role</th><th>Line</th><th>Status</th><th>Dibuat</th><th>Aksi</th></tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td>{user.email}</td>
                    <td><span className={`users-badge ${user.role === 'ADMIN' ? 'users-badge-admin' : ''}`}>{user.role}</span></td>
                    <td>{user.lineName ?? (user.role === 'ADMIN' ? 'Semua line' : 'Belum ditetapkan')}</td>
                    <td>{user.isActive ? 'Aktif' : 'Nonaktif'}</td>
                    <td>{new Date(user.createdAt).toLocaleDateString('id-ID')}</td>
                    <td className="users-actions">
                      <button type="button" onClick={() => startEdit(user)}>Edit</button>
                      <button type="button" onClick={() => void toggleStatus(user)}>{user.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button>
                      <button type="button" className="users-delete" disabled={user.id === currentUserId} onClick={() => void removeUser(user)}>Hapus</button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && <tr><td colSpan={7} className="users-empty">Tidak ada pengguna ditemukan.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="users-pagination">
          <span>{total} pengguna · Halaman {page} dari {totalPages}</span>
          <div>
            <button type="button" disabled={page <= 1 || loading} onClick={() => void loadUsers(search, page - 1)}>Sebelumnya</button>
            <button type="button" disabled={page >= totalPages || loading} onClick={() => void loadUsers(search, page + 1)}>Berikutnya</button>
          </div>
        </div>
      </section>

      {formOpen && (
        <section className="users-panel users-form-panel" aria-label="Form edit pengguna">
          <h2>{editing ? 'Edit Pengguna' : 'Tambah Pengguna'}</h2>
          <UserForm
            isEditing={Boolean(editing)} name={name} email={email} role={role} isActive={isActive} password={password}
            lineCode={lineCode} lines={lines}
            setName={setName} setEmail={setEmail} setRole={setRole} setIsActive={setIsActive}
            setPassword={setPassword} setLineCode={setLineCode}
            saving={saving} onSubmit={saveUser} onCancel={() => setFormOpen(false)}
          />
        </section>
      )}
    </main>
  );
}

type UserFormProps = {
  isEditing: boolean; name: string; email: string; role: User['role']; isActive: boolean; password: string; saving: boolean;
  lineCode: string; lines: ProductionLine[];
  setName: (value: string) => void; setEmail: (value: string) => void;
  setRole: (value: User['role']) => void; setIsActive: (value: boolean) => void;
  setLineCode: (value: string) => void;
  setPassword: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
};

function UserForm(props: UserFormProps) {
  return (
    <form className="users-form" onSubmit={props.onSubmit}>
      <label>Nama<input value={props.name} onChange={(event) => props.setName(event.target.value)} required maxLength={120} /></label>
      <label>Email<input type="email" value={props.email} onChange={(event) => props.setEmail(event.target.value)} required maxLength={254} /></label>
      <label>Role
        <select value={props.role} onChange={(event) => props.setRole(event.target.value as User['role'])}>
          <option value="USER">USER</option><option value="ADMIN">ADMIN</option>
        </select>
      </label>
      {props.role === 'USER' && (
        <label>Line produksi
          <select
            value={props.lineCode}
            onChange={(event) => props.setLineCode(event.target.value)}
            required
            disabled={props.lines.length === 0}
          >
            <option value="">Pilih line</option>
            {props.lines.map((line) => (
              <option key={line.lineCode} value={line.lineCode}>{line.name} ({line.lineCode})</option>
            ))}
          </select>
          {props.lines.length === 0 && <span>Tidak ada line aktif. Aktifkan line terlebih dahulu.</span>}
        </label>
      )}
      <label>Password {props.isEditing ? '(opsional; kosongkan jika tidak diubah)' : '(minimal 12 karakter)'}
        <input type="password" value={props.password} onChange={(event) => props.setPassword(event.target.value)} minLength={props.isEditing ? undefined : 12} required={!props.isEditing} maxLength={128} autoComplete="new-password" />
      </label>
      <label className="users-checkbox"><input type="checkbox" checked={props.isActive} onChange={(event) => props.setIsActive(event.target.checked)} /> Akun aktif</label>
      <div className="users-form-actions">
        <button type="submit" className="users-primary" disabled={props.saving}>{props.saving ? 'Menyimpan...' : 'Simpan'}</button>
        <button type="button" onClick={props.onCancel}>Batal</button>
      </div>
    </form>
  );
}
