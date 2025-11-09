
import React from 'react';
import Chat from './components/Chat';

function App() {
  return (
    <div className="bg-gray-900 text-gray-100 min-h-screen font-sans flex flex-col">
      <header className="bg-gray-800 shadow-lg p-4">
        <h1 className="text-2xl font-bold text-center text-emerald-400">
          <i className="fas fa-hands-helping mr-2"></i> HungerHelper AI
        </h1>
        <p className="text-center text-sm text-gray-400 mt-1">Your guide to finding local food assistance</p>
      </header>
      <main className="flex-grow flex items-center justify-center p-4">
        <Chat />
      </main>
    </div>
  );
}

export default App;
