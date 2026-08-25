"use client";

import { FormEvent, useState } from "react";
import type {
  AnswerValue,
  ClarificationQuestion,
  ClarificationResult,
} from "@/lib/trip-api/types";
import styles from "@/app/chat/new/chat.module.css";

function answerError(question: ClarificationQuestion, answer: AnswerValue | undefined) {
  const empty = answer === undefined
    || answer === null
    || (Array.isArray(answer) ? answer.length === 0 : String(answer).trim().length === 0);
  if (empty) return question.required ? "Choose an option or add your answer." : "";
  if (question.kind === "number") {
    const number = Number(answer);
    if (!Number.isFinite(number)) return "Enter a valid number.";
    if (question.min_value !== undefined && question.min_value !== null && number < question.min_value) {
      return `Enter ${question.min_value} or more.`;
    }
    if (question.max_value !== undefined && question.max_value !== null && number > question.max_value) {
      return `Enter ${question.max_value} or less.`;
    }
  }
  if (typeof answer === "string") {
    if (question.min_length && answer.length < question.min_length) {
      return `Use at least ${question.min_length} characters.`;
    }
    if (question.max_length && answer.length > question.max_length) {
      return `Use no more than ${question.max_length} characters.`;
    }
  }
  return "";
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
    const error = answerError(question, answers[question.id]);
    if (error) {
      setValidation(error);
      return;
    }
    setValidation("");
    setStep((current) => Math.min(current + 1, clarification.questions.length - 1));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLast) return continueStep();
    const error = answerError(question, answers[question.id]);
    if (error) {
      setValidation(error);
      return;
    }
    await onSubmit(answers);
  }

  const currentAnswer = answers[question.id];
  const usesOptions = (question.kind === "single_select" || multiple) && question.options.length > 0;
  const usingOther = Boolean(otherQuestions[question.id]);
  const descriptionId = question.description ? `${question.id}-description` : undefined;

  const customField = question.kind === "textarea"
    ? <textarea
        autoFocus
        disabled={disabled}
        rows={4}
        minLength={question.min_length ?? undefined}
        maxLength={question.max_length ?? 6000}
        value={typeof currentAnswer === "string" ? currentAnswer : ""}
        placeholder={question.placeholder ?? "Add any details that will improve the trip"}
        aria-describedby={descriptionId}
        onChange={(event) => update(event.target.value)}
      />
    : <input
        autoFocus
        disabled={disabled}
        type={question.kind === "number" ? "number" : question.kind === "date" ? "date" : "text"}
        inputMode={question.kind === "number" ? "decimal" : undefined}
        min={question.kind === "number" ? question.min_value ?? undefined : undefined}
        max={question.kind === "number" ? question.max_value ?? undefined : undefined}
        step={question.kind === "number" ? question.step ?? "any" : undefined}
        minLength={question.min_length ?? undefined}
        maxLength={question.kind === "number" || question.kind === "date" ? undefined : question.max_length ?? 300}
        value={typeof currentAnswer === "string" || typeof currentAnswer === "number" ? currentAnswer : ""}
        placeholder={question.placeholder ?? (question.kind === "location" ? "City, region, or address" : "Type your answer")}
        aria-describedby={descriptionId}
        onChange={(event) => update(event.target.value)}
      />;

  return <form className={styles.clarificationStepper} onSubmit={submit} aria-label="Trip clarification">
    <header>
      <div>
        <span>Question {step + 1} of {clarification.questions.length}</span>
        <strong>{question.prompt}</strong>
        {question.description && <small id={descriptionId}>{question.description}</small>}
      </div>
      <div className={styles.stepDots} aria-hidden="true">
        {clarification.questions.map((item, index) => <i
          className={index <= step ? styles.stepDotActive : ""}
          key={item.id}
        />)}
      </div>
    </header>

    {question.kind === "boolean" ? <div className={styles.stepOptions}>
      {[{ value: true, label: "Yes" }, { value: false, label: "No" }].map((option) => <button
        className={currentAnswer === option.value ? styles.stepOptionSelected : ""}
        type="button"
        disabled={disabled}
        key={option.label}
        aria-pressed={currentAnswer === option.value}
        onClick={() => update(option.value)}
      ><strong>{option.label}</strong></button>)}
    </div> : usesOptions && !usingOther ? <div className={styles.stepOptions}>
      {question.options.map((option) => {
        const selected = multiple
          ? Array.isArray(currentAnswer) && currentAnswer.includes(option.value)
          : currentAnswer === option.value;
        return <button
          className={selected ? styles.stepOptionSelected : ""}
          type="button"
          disabled={disabled}
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
      {question.allow_other !== false && <button
        className={styles.stepOther}
        type="button"
        disabled={disabled}
        onClick={() => {
          setOtherQuestions((current) => ({ ...current, [question.id]: true }));
          update("");
        }}
      >Other</button>}
    </div> : <div className={styles.stepCustomAnswer}>
      {customField}
      {usesOptions && <button type="button" disabled={disabled} onClick={() => {
        setOtherQuestions((current) => ({ ...current, [question.id]: false }));
        update("");
      }}>Show choices</button>}
    </div>}

    <footer>
      <span className={styles.stepValidation} role="alert">{validation}</span>
      <div>
        {step > 0 && <button type="button" disabled={disabled} onClick={() => setStep((current) => current - 1)}>Back</button>}
        <button className={styles.stepContinue} type="submit" disabled={disabled}>
          {disabled ? "Checking…" : isLast ? "Send answers" : "Next"}
        </button>
      </div>
    </footer>
  </form>;
}
