import React from 'react';
import { StatusBar } from 'react-native';
import { WorkoutTrackerScreen } from './src/screens/WorkoutTrackerScreen';

export default function App() {
  return (
    <>
      <StatusBar barStyle="light-content" />
      <WorkoutTrackerScreen />
    </>
  );
}
