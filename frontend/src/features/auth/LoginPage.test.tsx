import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { ToastProvider } from '@/components/ui/Toast';
import { ApiError } from '@/services/api';

const loginMock = vi.fn();
let isAuthMock = false;

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({
    login: loginMock,
    isLoading: false,
    isAuthenticated: isAuthMock,
  }),
}));

function renderLogin() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </ToastProvider>
  );
}

describe('LoginPage Comprehensive Suite', () => {
  beforeEach(() => {
    loginMock.mockReset();
    isAuthMock = false;
  });

  it('0. Menampilkan akun demonstrasi dengan identitas kelembagaan 1990-an', () => {
    renderLogin();
    expect(screen.getByText(/Ketua Panel — Perwakilan MPR:/)).toBeInTheDocument();
    expect(screen.getByText(/Anggota Panel 1 — Perwakilan DPR:/)).toBeInTheDocument();
    expect(screen.getByText(/Anggota Panel 2 — Utusan Daerah:/)).toBeInTheDocument();
    expect(screen.getByText(/dm1 \/ password123/)).toBeInTheDocument();
    expect(screen.getByText(/dm2 \/ password123/)).toBeInTheDocument();
    expect(screen.getByText(/dm3 \/ password123/)).toBeInTheDocument();
  });

  // 1. Input kosong
  it('1. Menampilkan validasi inline saat username dan password kosong', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: /masuk/i }));

    expect(await screen.findByText('Username wajib diisi.')).toBeInTheDocument();
    expect(await screen.findByText('Password wajib diisi.')).toBeInTheDocument();
    expect(loginMock).not.toHaveBeenCalled();
  });

  // 2. Format username tidak valid
  it('2. Menampilkan validasi inline jika format username salah (<3 char / ada spasi)', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Username'), 'a b');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: /masuk/i }));

    expect(await screen.findByText('Username 3-50 karakter, hanya huruf, angka, underscore.')).toBeInTheDocument();
    expect(loginMock).not.toHaveBeenCalled();
  });

  // 3. Password kurang dari 6 karakter
  it('3. Menampilkan validasi inline jika password < 6 karakter', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Username'), 'dm1');
    await user.type(screen.getByLabelText('Password'), '12345');
    await user.click(screen.getByRole('button', { name: /masuk/i }));

    expect(await screen.findByText('Password minimal 6 karakter.')).toBeInTheDocument();
    expect(loginMock).not.toHaveBeenCalled();
  });

  // 4. Kredensial valid memanggil login()
  it('4. Memanggil login dengan kredensial benar', async () => {
    const user = userEvent.setup();
    loginMock.mockResolvedValue(undefined);
    renderLogin();

    await user.type(screen.getByLabelText('Username'), 'dm1');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: /masuk/i }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('dm1', 'password123');
    });
  });

  // 5. Error 401: Kredensial tidak valid
  it('5. Menampilkan error inline dan mempertahankan username saat login ditolak 401', async () => {
    const user = userEvent.setup();
    loginMock.mockRejectedValue(new ApiError(401, 'Username atau password tidak valid.'));
    renderLogin();

    const uInput = screen.getByLabelText('Username') as HTMLInputElement;
    const pInput = screen.getByLabelText('Password') as HTMLInputElement;

    await user.type(uInput, 'dm1');
    await user.type(pInput, 'passwordSalah');
    await user.click(screen.getByRole('button', { name: /masuk/i }));

    const errorElements = await screen.findAllByText('Username atau password tidak valid.');
    expect(errorElements.length).toBeGreaterThan(0);
    // Username tetap dipertahankan
    expect(uInput.value).toBe('dm1');
    // Password direset
    expect(pInput.value).toBe('');
  });

  // 6. Error 429: Terlalu banyak percobaan
  it('6. Menampilkan pesan rate-limit 429 pada toast/banner', async () => {
    const user = userEvent.setup();
    loginMock.mockRejectedValue(new ApiError(429, 'Terlalu banyak percobaan login gagal. Silakan coba kembali setelah 15 menit.'));
    renderLogin();

    await user.type(screen.getByLabelText('Username'), 'dm1');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: /masuk/i }));

    const matches = await screen.findAllByText(/Terlalu banyak percobaan login gagal/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  // 7. Error Jaringan / Backend down
  it('7. Menampilkan pesan ramah jika backend tidak dapat dihubungi', async () => {
    const user = userEvent.setup();
    loginMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderLogin();

    await user.type(screen.getByLabelText('Username'), 'dm1');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: /masuk/i }));

    const matches = await screen.findAllByText(/Tidak dapat terhubung ke server/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  // 8. Toggle password visibility
  it('8. Toggle tampil/sembunyikan password berfungsi', async () => {
    const user = userEvent.setup();
    renderLogin();

    const pInput = screen.getByLabelText('Password') as HTMLInputElement;
    const toggleBtn = screen.getByRole('button', { name: /Tampilkan password/i });

    expect(pInput.type).toBe('password');
    await user.click(toggleBtn);
    expect(pInput.type).toBe('text');
    expect(screen.getByRole('button', { name: /Sembunyikan password/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Sembunyikan password/i }));
    expect(pInput.type).toBe('password');
  });

  // 9. Tombol disabled saat submitting (cegah double submit)
  it('9. Tombol masuk disabled saat proses login berlangsung', async () => {
    const user = userEvent.setup();
    // Promise yang sengaja ditunda
    let resolveLogin: (value?: unknown) => void = () => {};
    loginMock.mockImplementation(() => new Promise((resolve) => { resolveLogin = resolve; }));

    renderLogin();

    await user.type(screen.getByLabelText('Username'), 'dm1');
    await user.type(screen.getByLabelText('Password'), 'password123');

    const submitBtn = screen.getByRole('button', { name: /masuk/i });
    await user.click(submitBtn);

    // Tombol harus disabled dan menampilkan teks loading
    expect(screen.getByRole('button', { name: /Sedang Masuk/i })).toBeDisabled();

    // Selesaikan
    resolveLogin();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Sedang Masuk/i })).not.toBeInTheDocument();
    });
  });

  // 10. Jika sudah terautentikasi, tampilkan loading redirect
  it('10. Pengguna yang sudah login diarahkan dengan teks penunjuk', () => {
    isAuthMock = true;
    renderLogin();

    expect(screen.getByText('Mengarahkan ke dashboard...')).toBeInTheDocument();
  });
});
