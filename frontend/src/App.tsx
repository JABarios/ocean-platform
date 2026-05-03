import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
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

export default function App() {
  const isShareHost = typeof window !== 'undefined' && window.location.hostname.startsWith('share.')

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/open" element={<OpenLocalEeg />} />
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
        path="/shared/new"
        element={<SharedLinkNew />}
      />
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
