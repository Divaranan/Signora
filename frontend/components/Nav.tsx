'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
export default function Nav(){const router=useRouter();function logout(){localStorage.removeItem('token');router.push('/login');}return <header className="nav"><Link className="brand" href="/dashboard">Signora</Link><div className="navlinks"><Link href="/dashboard">Dashboard</Link><Link href="/upload">Upload PDF</Link><button className="btn ghost" onClick={logout}>Logout</button></div></header>}
