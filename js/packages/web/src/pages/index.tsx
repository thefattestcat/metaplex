import dynamic from 'next/dynamic';
import React from 'react';

const CreateReactAppEntryPoint = dynamic(() => import('../App'), {
  ssr: false,
});

function App() {
  // eslint-disable-next-line react/react-in-jsx-scope
  return <CreateReactAppEntryPoint />;
}

export default App;
