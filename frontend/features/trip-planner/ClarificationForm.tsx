"use client";

import { FormEvent, useState } from "react";
import type {
  AnswerValue,
  ClarificationQuestion,
  ClarificationResult,
} from "@/lib/trip-api/types";
import styles from "@/app/chat/new/chat.module.css";

function hasAnswer(question: ClarificationQuestion, answer: AnswerValue | undefined) {
  if (!question.required) return true;
  if (Array.isArray(answer)) return answer.length > 0;
  return answer !== undefined && answer !== null && String(answer).trim().length > 0;
}

export function ClarificationForm({
  clarification,
  disabled,
  onSubmit,
}: {
  clarification: ClarificationResult;
  disabled: boolean;
  onSubmit: (answers: Record<string, AnswerValue>) => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [otherQuestions, setOtherQuestions] = useState<Record<string, boolean>>({});
  const [validation, setValidation] = useState("");
  const question = clarification.questions[step];
  const isLast = step === clarification.questions.length - 1;
  const multiple = question.kind === "multi_select";

  function update(value: AnswerValue) {
    setAnswers((current) => ({ ...current, [question.id]: value }));
    setValidation("");
  }

  function continueStep() {
    if (!hasAnswer(question, answers[question.id])) {
      setValidation("Choose an option or add your own answer.");
      return;
    }
    setValidation("");
    setStep((current) => Math.min(current + 1, clarification.questions.length - 1));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLast) return continueStep();
    if (!hasAnswer(question, answers[question.id])) {
      setValidation("Choose an option or add your own answer.");
      return;
    }
    await onSubmit(answers);
  }

  const currentAnswer = answers[question.id];
  const usesOptions = question.options.length > 0;
  const usingOther = Boolean(otherQuestions[question.id]);

  return <form className={styles.clarificationStepper} onSubmit={submit} aria-label="Trip clarification">
    <header>
      <div>
        <span>Question {step + 1} of {clarification.questions.length}</span>
        <strong>{question.prompt}</strong>
      </div>
      <div className={styles.stepDots} aria-hidden="true">
        {clarification.questions.map((item, index) => <i
          className={index <= step ? styles.stepDotActive : ""}
          key={item.id}
        />)}
      </div>
    </header>

    {usesOptions && !usingOther ? <div className={styles.stepOptions}>
      {question.options.map((option) => {
        const selected = multiple
          ? Array.isArray(currentAnswer) && currentAnswer.includes(option.value)
          : currentAnswer === option.value;
        return <button
          className={selected ? styles.stepOptionSelected : ""}
          type="button"
          key={option.value}
          aria-pressed={selected}
          onClick={() => {
            if (!multiple) return update(option.value);
            const current = Array.isArray(currentAnswer) ? currentAnswer : [];
            update(selected
              ? current.filter((value) => value !== option.value)
              : [...current, option.value]);
          }}
        >
          <strong>{option.label}</strong>
          {option.description && <small>{option.description}</small>}
        </button>;
      })}
      <button
        className={styles.stepOther}
        type="button"
        onClick={() => {
          setOtherQuestions((current) => ({ ...current, [question.id]: true }));
          update("");
        }}
      >Other</button>
    </div> : <div className={styles.stepCustomAnswer}>
      <input
        autoFocus
        type={question.kind === "number" ? "number" : "text"}
        inputMode={question.kind === "number" ? "numeric" : undefined}
        min={question.kind === "number" ? 1 : undefined}
        max={question.kind === "number" ? 50 : undefined}
        maxLength={question.kind === "number" ? undefined : 300}
        value={typeof currentAnswer === "string" || typeof currentAnswer === "number" ? currentAnswer : ""}
        placeholder={question.kind === "location" ? "City, region, or address" : "Type your answer"}
        onChange={(event) => update(event.target.value)}
      />
      {usesOptions && <button type="button" onClick={() => {
        setOtherQuestions((current) => ({ ...current, [question.id]: false }));
        update("");
      }}>Show choices</button>}
    </div>}

    <footer>
      <span className={styles.stepValidation} role="alert">{validation}</span>
      <div>
        {step > 0 && <button type="button" onClick={() => setStep((current) => current - 1)}>Back</button>}
        <button className={styles.stepContinue} type="submit" disabled={disabled}>
          {disabled ? "Checking…" : isLast ? "Send answers" : "Next"}
        </button>
      </div>
    </footer>
  </form>;
}
