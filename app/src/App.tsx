import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AdminGate } from './components/AdminGate'
import { ConnectModal, Footer, Nav, Toasts } from './components/Shell'
import { Starfield } from './components/Starfield'
import About from './pages/About'
import Admin from './pages/Admin'
import Explore from './pages/Explore'
import FounderDashboard from './pages/FounderDashboard'
import Home from './pages/Home'
import ListWizard from './pages/ListWizard'
import Portfolio from './pages/Portfolio'
import StartupPage from './pages/StartupPage'
import Trade from './pages/Trade'

export default function App() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return (
    <>
      <Starfield />
      <Nav />
      <main key={pathname} className="route-in mx-auto max-w-[1180px] px-4 pt-[96px] sm:px-5 sm:pt-[112px]">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/trade" element={<Trade />} />
          <Route path="/s/:id" element={<StartupPage />} />
          <Route path="/list" element={<ListWizard />} />
          <Route path="/founder" element={<FounderDashboard />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/about" element={<About />} />
          <Route path="/admin" element={<AdminGate><Admin /></AdminGate>} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <Footer />
      <ConnectModal />
      <Toasts />
    </>
  )
}
