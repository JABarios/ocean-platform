import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import CaseNew from './pages/CaseNew'
import CaseDetail from './pages/CaseDetail'
import TeachingLibrary from './pages/TeachingLibrary'
import TeachingQueue from './pages/TeachingQueue'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout>
              <Dashboard />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/cases/new"
        element={
          <ProtectedRoute>
            <Layout>
              <CaseNew />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/cases/:id"
        element={
          <ProtectedRoute>
            <Layout>
              <CaseDetail />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/library"
        element={
          <ProtectedRoute>
            <Layout>
              <TeachingLibrary />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/queue"
        element={
          <ProtectedRoute>
            <Layout>
              <TeachingQueue />
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}
