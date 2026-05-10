import { useEffect } from 'react'
import { Navigate, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import { useAuthStore } from './store/authStore'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import CaseNew from './pages/CaseNew'
import CaseDetail from './pages/CaseDetail'
import EEGViewer from './pages/EEGViewer'
import TeachingLibrary from './pages/TeachingLibrary'
import TeachingQueue from './pages/TeachingQueue'
import UserAdmin from './pages/UserAdmin'
import CleanupAdmin from './pages/CleanupAdmin'
import CaseOperations from './pages/CaseOperations'
import EegRecords from './pages/EegRecords'
import Galleries from './pages/Galleries'
import GalleryDetail from './pages/GalleryDetail'
import AdminHome from './pages/AdminHome'
import SharedLinkNew from './pages/SharedLinkNew'
import OpenLocalEeg from './pages/OpenLocalEeg'
import OpenCasesFeed from './pages/OpenCasesFeed'

export default function App() {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const fetchMe = useAuthStore((s) => s.fetchMe)
  const isShareHost = typeof window !== 'undefined' && window.location.hostname.startsWith('share.')

  useEffect(() => {
    if (token && !user) {
      fetchMe()
    }
  }, [token, user, fetchMe])

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/open" element={<OpenLocalEeg />} />
      <Route path="/open/cache/:cacheId" element={<EEGViewer />} />
      <Route path="/open/:localId" element={<EEGViewer />} />
      <Route path="/share" element={<SharedLinkNew />} />
      <Route
        path="/"
        element={
          isShareHost ? (
            <SharedLinkNew />
          ) : (
            <ProtectedRoute>
              <Layout>
                <Dashboard />
              </Layout>
            </ProtectedRoute>
          )
        }
      />
      <Route
        path="/cases/open"
        element={
          <ProtectedRoute>
            <Layout>
              <OpenCasesFeed />
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
        path="/share/new"
        element={
          <ProtectedRoute>
            <Layout>
              <SharedLinkNew />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route path="/shared/new" element={<SharedLinkNew />} />
      <Route
        path="/cases"
        element={
          <ProtectedRoute>
            <Layout>
              <CaseOperations />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/cases/manage"
        element={
          <ProtectedRoute>
            <Layout>
              <CaseOperations />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/eegs"
        element={
          <ProtectedRoute>
            <Layout>
              <EegRecords />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/galleries"
        element={
          <ProtectedRoute>
            <Layout>
              <Galleries />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/explore"
        element={
          <ProtectedRoute>
            <Navigate to="/galleries" replace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/galleries/:id"
        element={
          <ProtectedRoute>
            <Layout>
              <GalleryDetail />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route path="/v/:sharedId" element={<EEGViewer />} />
      <Route path="/galleries/records/:recordId/eeg" element={<EEGViewer />} />
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
      <Route path="/cases/:id/eeg" element={<EEGViewer />} />
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
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <Layout>
              <AdminHome />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute>
            <Layout>
              <UserAdmin />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/cleanup"
        element={
          <ProtectedRoute>
            <Layout>
              <CleanupAdmin />
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}
