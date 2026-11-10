import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Signora | Document Portal', description: 'Upload and manage PDF documents' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
