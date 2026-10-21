import { useEffect } from 'react';
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { TrainingView } from './components/TrainingView';
import { HomeView, ExerciseCatalog, ExerciseDetails, ProgressView } from './components/DashboardViews';
import { SettingsView } from './components/PreferencesView';
import { AppNavigation, TopBar } from './components/AppNavigation';
import { WelcomeView } from './components/WelcomeView';
import { HistoryView } from './components/HistoryView';
import { Icon } from './components/Icon';
import { useAccount } from './account/context';
import { AuthView, ProfileView } from './account/AccountViews';
import { AccountHistoryView, AccountHistoryDetail } from './account/AccountHistory';
import { readSelection, selectionSearch } from './routing/selection';
import './style.css';
import './redesign.css';
import { ProgramCatalog, ProgramDetails } from './programs/ProgramViews';
import { ProgramEditor } from './programs/ProgramEditor';
import { OverviewView } from './account/ProgressionViews';
import { ChallengesPage, ChallengeDetails } from './challenges/ChallengeViews';
import { DuelDetails, DuelInvite, DuelsPage, NewDuel } from './duels/DuelViews';
import { LeaderboardPage, PublicParticipantPage } from './leaderboard/LeaderboardViews';

export default function App() {
  const { user } = useAccount();
  const location = useLocation();
  const routerNavigate = useNavigate();
  const { exercise, mode } = readSelection(['/', '/training', '/history'].includes(location.pathname) ? location.search : '');
  const search = selectionSearch({ exercise, mode });
  const navigate = (next: 'home' | 'training' | 'history', nextMode = mode) => {
    void routerNavigate({ pathname: next === 'home' ? '/' : `/${next}`, search: selectionSearch({ exercise, mode: nextMode }) });
  };
  useEffect(() => {
    // Invalid, duplicate and unknown parameters never reach the training runtime.
    if (['/', '/training', '/history'].includes(location.pathname) && location.search !== search) {
      void routerNavigate({ pathname: location.pathname, search, hash: location.hash }, { replace: true });
    }
  }, [location.pathname, location.search, location.hash, search, routerNavigate]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
      if (target) target.scrollIntoView({ block: 'start' }); else window.scrollTo({ top: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, location.hash]);
  return <div className={`app-shell ${location.pathname === '/welcome' ? 'onboarding-shell' : ''}`} >
    <a className='skip-link' href='#main-content'>Перейти к содержимому</a>
    <AppNavigation search={search} />
    <TopBar />
    {user?.isDemo && <aside className='demo-session' role='note'><strong>Учебный аккаунт</strong> · Вымышленные результаты для показа платформы. <Link to='/leaderboard?mode=demo'>Учебный рейтинг</Link></aside>}
    <div id='main-content' tabIndex={-1}>
    <Routes>
    <Route path='/login' element={<AuthView key='login' />} />
    <Route path='/register' element={<AuthView key='register' register />} />
    <Route path='/profile' element={<ProfileView key={user?.id} />} />
    <Route path='/overview' element={<OverviewView key={user?.id} />} />
    <Route path='/leaderboard' element={<LeaderboardPage key={user?.id}/>} />
    <Route path='/participants/:id' element={<PublicParticipantPage key={location.pathname}/>} />
    <Route path='/competitions' element={<ChallengesPage key={user?.id}/>} />
    <Route path='/competitions/duels' element={<DuelsPage key={user?.id}/>} />
    <Route path='/competitions/duels/new' element={<NewDuel key={user?.id}/>} />
    <Route path='/competitions/duels/invite/:code' element={<DuelInvite key={`${user?.id}-${location.pathname}`}/>} />
    <Route path='/competitions/duels/:id' element={<DuelDetails key={`${user?.id}-${location.pathname}`}/>} />
    <Route path='/competitions/challenges/:id' element={<ChallengeDetails key={`${user?.id}-${location.pathname}`}/>} />
    <Route path='/programs' element={<ProgramCatalog />} />
    <Route path='/my-programs' element={<ProgramCatalog key='mine' scope='mine' />} />
    <Route path='/favorites' element={<ProgramCatalog key='favorites' scope='favorites' />} />
    <Route path='/programs/new' element={<ProgramEditor key='new' />} />
    <Route path='/programs/:id/edit' element={<ProgramEditor key={location.pathname} />} />
    <Route path='/programs/:id' element={<ProgramDetails key={location.pathname} />} />
    <Route path='/history' element={user ? <AccountHistoryView user={user} onHome={() => navigate('home')} /> : <HistoryView onHome={() => navigate('home')} />} />
    <Route path='/history/:id' element={<AccountHistoryDetail />} />
    <Route path='/training' element={<TrainingView key={`${exercise}-${mode}`} exercise={exercise} mode={mode} onHome={() => navigate('home')} />} />
    <Route path='/' element={<HomeView exercise={exercise} mode={mode} />} />
    <Route path='/exercises' element={<ExerciseCatalog />} />
    <Route path='/exercises/:id' element={<ExerciseDetails />} />
    <Route path='/progress' element={<ProgressView key={user?.id ?? 'guest'} />} />
    <Route path='/settings' element={<SettingsView key={user?.id ?? 'guest'} />} />
    <Route path='/welcome' element={<WelcomeView />} />
    <Route path='*' element={<main className='history-page page-enter'><section className='empty-state'><span className='eyebrow'>404</span><h1>Страница не найдена<span className='accent'>.</span></h1><p>Проверь адрес или выбери тренировку на главной.</p><Link className='button button-primary' to={{ pathname: '/', search }}>На главную <Icon name='arrow' /></Link></section></main>} />
    </Routes>
    </div>
  </div>;
}
