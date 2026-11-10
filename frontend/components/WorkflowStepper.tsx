'use client';
import Link from 'next/link';
import { Upload, PenTool, Users, Activity } from 'lucide-react';

interface WorkflowStepperProps {
  docId: string;
  currentStep: 'prepare' | 'signers' | 'status';
}

export default function WorkflowStepper({ docId, currentStep }: WorkflowStepperProps) {
  const steps = [
    { key: 'prepare', label: '1. Place Boxes', icon: PenTool, href: `/documents/${docId}/prepare` },
    { key: 'signers', label: '2. Signers & Send', icon: Users, href: `/documents/${docId}/signers` },
    { key: 'status', label: '3. Status & Audit', icon: Activity, href: `/documents/${docId}/status` },
  ];

  return (
    <nav className="stepper" aria-label="Document workflow steps">
      {steps.map((step, idx) => {
        const Icon = step.icon;
        const isActive = currentStep === step.key;
        return (
          <Link
            key={step.key}
            href={step.href}
            className={`step-item ${isActive ? 'active' : ''}`}
          >
            <div className="step-num">{idx + 1}</div>
            <Icon size={16} />
            <span>{step.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

