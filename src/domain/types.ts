export interface BilingualText {
  en: string;
  hi: string;
}

export interface Question {
  id: string;
  section: string;
  question: BilingualText;
  options: BilingualText[];
  correctAnswer: number;
  explanation: BilingualText;
}

export interface MockTest {
  id: string;
  name: string;
  sections: string[];
  totalTime: number;
  questions: Question[];
}

export interface Candidate {
  userId: string;
  name: string;
  rollNumber: string;
  currentAttempt?: string;
  darkModePreference: boolean;
}

export interface Attempt {
  id: string;
  userId: string;
  testId: string;
  answers: Record<string, number>;
  markedForReview: string[];
  currentQuestion: number;
  startedAt: string;
  submittedAt?: string;
  score?: number;
}

export interface AdminCredentials {
  passwordHash: string;
}
