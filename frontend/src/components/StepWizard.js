import React from 'react';

const steps = [
  { num: 1, icon: '📍', label: 'State',     desc: 'Choose your state' },
  { num: 2, icon: '🎟️', label: 'Lotteries', desc: 'Pick lotteries' },
  { num: 3, icon: '📅', label: 'Dates',     desc: 'Set date range' },
  { num: 4, icon: '✅', label: 'Results',   desc: 'View results' },
];

export default function StepWizard({ currentStep }) {
  return (
    <div className="wizard" role="progressbar" aria-valuenow={currentStep} aria-valuemin={1} aria-valuemax={4}>
      {steps.map((step, idx) => {
        const done   = currentStep > step.num;
        const active = currentStep === step.num;
        return (
          <React.Fragment key={step.num}>
            <div
              className={`wizard__step${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}
              aria-label={`Step ${step.num}: ${step.label}${done ? ' (completed)' : active ? ' (current)' : ''}`}
            >
              <div className="wizard__bubble">
                {done
                  ? <span className="wizard__check">✓</span>
                  : <span className="wizard__icon">{step.icon}</span>
                }
                {active && <span className="wizard__pulse" aria-hidden="true" />}
              </div>
              <div style={{ textAlign: 'center' }}>
                <span className="wizard__label">{step.label}</span>
              </div>
            </div>

            {idx < steps.length - 1 && (
              <div className={`wizard__line${done ? ' is-done' : ''}`} aria-hidden="true" />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
