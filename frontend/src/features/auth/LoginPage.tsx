import React, { useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { describeApiError, ApiError } from '@/services/api';
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';

interface FieldError {
  message: string;
  type: 'required' | 'format' | 'server';
}

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuth();
  const { error: showErrorToast } = useToast();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Field-level errors (inline)
  const [fieldErrors, setFieldErrors] = useState<Record<string, FieldError | null>>({
    username: null,
    password: null,
  });

  // System error (toast)
  const [systemError, setSystemError] = useState<string | null>(null);

  // Validasi inline saat blur/change
  const validateUsername = useCallback((value: string): FieldError | null => {
    const trimmed = value.trim();
    if (!trimmed) return { message: 'Username wajib diisi.', type: 'required' };
    if (trimmed.length < 3 || trimmed.length > 50 || !/^[a-z0-9_]+$/i.test(trimmed)) {
      return { message: 'Username 3-50 karakter, hanya huruf, angka, underscore.', type: 'format' };
    }
    return null;
  }, []);

  const validatePassword = useCallback((value: string): FieldError | null => {
    if (!value) return { message: 'Password wajib diisi.', type: 'required' };
    if (value.length < 6) return { message: 'Password minimal 6 karakter.', type: 'format' };
    return null;
  }, []);

  const handleUsernameChange = (value: string) => {
    setUsername(value);
    // Clear error on change
    if (fieldErrors.username) {
      setFieldErrors(prev => ({ ...prev, username: null }));
    }
  };

  const handleUsernameBlur = () => {
    const err = validateUsername(username);
    if (err) setFieldErrors(prev => ({ ...prev, username: err }));
  };

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    if (fieldErrors.password) {
      setFieldErrors(prev => ({ ...prev, password: null }));
    }
  };

  const handlePasswordBlur = () => {
    const err = validatePassword(password);
    if (err) setFieldErrors(prev => ({ ...prev, password: err }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSystemError(null);

    const uErr = validateUsername(username);
    const pErr = validatePassword(password);
    if (uErr || pErr) {
      setFieldErrors({
        username: uErr,
        password: pErr,
      });
      return;
    }

    setIsSubmitting(true);

    try {
      await login(username, password);
      // login() throws on failure; jika sukses, arahkan ke dashboard
      navigate('/dashboard', { replace: true });
    } catch (err) {
      // API error: map ke pesan user-friendly
      const friendly = describeApiError(err, 'Login gagal. Silakan coba lagi.');

      // Tentukan apakah error field-specific atau sistem
      if (err instanceof ApiError) {
        const status = err.status;
        if (status === 401) {
          // Kredensial salah — satu pesan inline saja (jangan gandakan di 2 field)
          setFieldErrors({ username: null, password: { message: friendly, type: 'server' } });
        } else if (status === 422) {
          // Validasi backend — biasanya sudah ditangani client-side, tapi jaga-jaga
          setSystemError(friendly);
          showErrorToast('Validasi Gagal', friendly);
        } else if (status === 429) {
          showErrorToast('Terlalu Banyak Percobaan', friendly);
          setSystemError(friendly);
        } else if (status >= 500) {
          showErrorToast('Server Error', friendly);
          setSystemError(friendly);
        } else {
          showErrorToast('Error', friendly);
          setSystemError(friendly);
        }
      } else {
        // Network/parse error
        showErrorToast('Koneksi Gagal', friendly);
        setSystemError(friendly);
      }
      // Hapus password, pertahankan username
      setPassword('');
    } finally {
      setIsSubmitting(false);
    }
  };

  React.useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  if (isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-navy-800 to-navy-900">
        <div className="text-center text-white">
          <div className="w-12 h-12 border-4 border-white border-t-gold-accent rounded-full animate-spin mx-auto mb-4"></div>
          <p>Mengarahkan ke dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy-800 to-navy-900 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="mb-8 text-center">
          <div className="inline-block bg-gold-accent px-4 py-2 rounded-lg mb-4">
            <h1 className="text-2xl font-bold text-navy-800 tracking-tight">PILPRESS</h1>
          </div>
          <p className="text-gold-accent text-sm font-medium">Sistem Pendukung Keputusan Kelompok</p>
          <p className="text-slate-300 text-sm mt-1">Pemilihan Calon Presiden</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-xl font-bold text-navy-800 mb-6 text-center">Masuk Ke Aplikasi</h2>

          {/* System error banner */}
          {systemError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2" role="alert">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 text-sm">{systemError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {/* Username */}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-slate-700 mb-1">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={e => handleUsernameChange(e.target.value)}
                onBlur={handleUsernameBlur}
                className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-gold-accent transition ${
                  fieldErrors.username ? 'border-red-400 bg-red-50' : 'border-slate-300'
                }`}
                placeholder="dm1"
                disabled={isSubmitting}
                autoComplete="username"
                aria-invalid={fieldErrors.username ? 'true' : 'false'}
                aria-describedby={fieldErrors.username ? 'username-error' : undefined}
              />
              {fieldErrors.username && (
                <p id="username-error" className="mt-1 text-xs text-red-600" role="alert">
                  {fieldErrors.username.message}
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => handlePasswordChange(e.target.value)}
                  onBlur={handlePasswordBlur}
                  className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-gold-accent transition pr-10 ${
                    fieldErrors.password ? 'border-red-400 bg-red-50' : 'border-slate-300'
                  }`}
                  placeholder="••••••••"
                  disabled={isSubmitting}
                  autoComplete="current-password"
                  aria-invalid={fieldErrors.password ? 'true' : 'false'}
                  aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(prev => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-navy-800"
                  aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {fieldErrors.password && (
                <p id="password-error" className="mt-1 text-xs text-red-600" role="alert">
                  {fieldErrors.password.message}
                </p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-navy-800 text-white font-semibold py-2.5 rounded-lg hover:bg-navy-900 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Sedang Masuk...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  Masuk
                </>
              )}
            </button>
          </form>

          {/* Registration link */}
          <div className="mt-5 text-center">
            <p className="text-sm text-slate-600">
              Belum punya akun?{' '}
              <Link to="/register" className="text-gold-accent font-semibold hover:underline">
                Daftar sebagai pemilih
              </Link>
            </p>
          </div>

          {/* Demo Accounts */}
          <div className="mt-6 p-4 bg-slate-50 rounded-lg">
            <p className="text-xs font-semibold text-slate-600 mb-2">Akun Demonstrasi:</p>
            <div className="text-xs text-slate-600 space-y-1 font-mono">
              <p><span className="font-medium">Ketua Panel — Perwakilan MPR:</span> dm1 / password123</p>
              <p><span className="font-medium">Anggota Panel 1 — Perwakilan DPR:</span> dm2 / password123</p>
              <p><span className="font-medium">Anggota Panel 2 — Utusan Daerah:</span> dm3 / password123</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-slate-400 text-xs mt-8">
          Simulasi GDSS untuk keperluan akademik 2026
        </p>
      </div>
    </div>
  );
};