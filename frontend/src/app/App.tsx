import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { HomePage } from '@/pages';
import '@/app/styles/theme.css';

function AppRoutes() {
  const navigate = useNavigate();

  const handleRegister = () => {
    // Navigate to register page or open modal
    navigate('/register');
  };

  const handleLogin = () => {
    // Navigate to login page or open modal
    navigate('/login');
  };

  return (
    <Routes>
      <Route 
        path="/" 
        element={
          <HomePage 
            onRegisterClick={handleRegister}
            onLoginClick={handleLogin}
          />
        } 
      />
      {/* Add more routes as needed */}
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
