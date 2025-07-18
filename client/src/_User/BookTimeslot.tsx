import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CalendarCheck, Mail, ArrowRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { isBefore, startOfDay } from "date-fns";
import { Input } from '@/components/ui/input';

import {
  Infrastructure,
  BookingEntry,
  fetchInfrastAvailTimeslots,
  fetchInfrastructureQuestions,
  FilterQuestionData,
  BookingReqAnswersMap,
  Message,
  formatTimeString,
  requestBooking,
  formatDate
} from '@/utils';
import { LOGIN } from '@/RoutePaths';
import BasePageLayout from '@/components/_BasePageLayout';
import InfrastructureSelector from '@/components/_InfrastructureSelector';
import { useTranslation } from 'react-i18next';

const ALERT_MESSAGE_TIME: number = 4000;

const BookTimeslot = () => {
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(true);
  const [isProcessingGuestBooking, setIsProcessingGuestBooking] = useState(false);
  const [allTimeslots, setAllTimeslots] = useState<BookingEntry[]>([]);
  const [selectedDateTimeslots, setDateTimeslots] = useState<BookingEntry[]>([]);
  const [isLoadingTimeslots, setIsLoadingTimeslots] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedInfrastructure, setSelectedInfrastructure] = useState<Infrastructure | null>(null);
  const [selectedTimeslotId, setSelectedTimeslotId] = useState<number | undefined>(undefined);
  const [purpose, setPurpose] = useState<string>('');
  const [message, setMessage] = useState<Message | null>(null);
  const [questions, setQuestions] = useState<FilterQuestionData[]>([]);
  const [answers, setAnswers] = useState<BookingReqAnswersMap>({});
  const [isFormValid, setIsFormValid] = useState(false);
  const { t, i18n } = useTranslation();

  // Guest-specific state
  const [searchParams] = useSearchParams();
  const isGuestMode = searchParams.get('guest') === 'true';
  const [guestEmail, setGuestEmail] = useState<string>('');
  const [showGuestEmailForm, setShowGuestEmailForm] = useState(false);
  const [guestName, setGuestName] = useState<string>('');

  // Fetch all available timeslots and filter-questions for the selected infrastructure
  useEffect(() => {
    if (selectedInfrastructure) {
      fetchAllAvailableTimeslots();
      fetchInfrastructureQuestions(selectedInfrastructure.id)
        .then(data => {
          setQuestions(data);
          // Initialize answers state with empty values
          const initialAnswers: BookingReqAnswersMap = {};
          data.forEach(q => {
            initialAnswers[q.id] = q.question_type === 'document' ? null : '';
          });
          setAnswers(initialAnswers);
        })
        .catch(err => {
          console.error('Error fetching questions:', err);
        });
      setIsLoading(false);
    } else {
      setAllTimeslots([]);
      setDateTimeslots([]);
      setIsLoading(true);
    }
  }, [selectedInfrastructure]);

  // Filter timeslots for the selected date
  useEffect(() => {
    if (selectedDate && allTimeslots.length > 0) {
      const selectedDay = startOfDay(selectedDate).getTime();

      const filtered = allTimeslots.filter(slot => {
        const slotDay = startOfDay(slot.booking_date).getTime();
        return slotDay === selectedDay;
      });

      setDateTimeslots(filtered);
    } else {
      setDateTimeslots([]);
    }
  }, [selectedDate, allTimeslots]);

  // Validate form whenever dependencies change
  useEffect(() => {
    validateForm();
  }, [selectedTimeslotId, answers, questions]);

  // Form validation function to check all required fields
  const validateForm = () => {
    // Basic form validation - must have a timeslot selected
    if (!selectedTimeslotId) {
      setIsFormValid(false);
      return;
    }

    // If no questions or no required questions, form is valid
    if (questions.length === 0) {
      setIsFormValid(true);
      return;
    }

    // Check each required question for a valid answer
    for (const q of questions.filter(q => q.is_required)) {
      const answer = answers[q.id];
      let isAnswerValid = false;

      switch (q.question_type) {
        case 'text':
        case 'dropdown':
          // For text/dropdown, must be non-empty string
          isAnswerValid = typeof answer === 'string' && answer.trim() !== '';
          break;

        case 'number':
          // For numbers, must be a number or a non-empty string
          isAnswerValid =
            (typeof answer === 'number' && !isNaN(answer)) ||
            (typeof answer === 'string' && answer.trim() !== '');
          break;

        case 'document':
          // For documents, must be a File object
          isAnswerValid = answer instanceof File;
          break;

        default:
          // Unknown type, consider it missing
          isAnswerValid = false;
      }

      if (!isAnswerValid) {
        setIsFormValid(false);
        return;
      }
    }

    // If we get here, all required fields are valid
    setIsFormValid(true);
  };

  const fetchAllAvailableTimeslots = async () => {
    if (!selectedInfrastructure) return;

    try {
      setIsLoadingTimeslots(true);
      const data = await fetchInfrastAvailTimeslots(selectedInfrastructure.id);
      setAllTimeslots(data);
    } catch (error) {
      console.error('Error fetching available timeslots:', error);
      setMessage({ type: 'error', text: t('bookTimeslot.msgErrTsFetch', 'Error loading available timeslots') });
    } finally {
      setIsLoadingTimeslots(false);
    }
  };

  // Calculate the list of dates that have available timeslots
  const availableDates = useMemo(() => {
    if (!allTimeslots.length) return [];
    console.log("Fetched timeslots:", allTimeslots.length);
    // // Extract unique dates as Date objects
    // const uniqueDates = [...new Set(allTimeslots.map(slot => new Date(slot.booking_date)))];
    const uniqueDates = Array.from(
      new Set(
        // Force every slot.date to *local* midnight
        allTimeslots.map(slot => startOfDay(new Date(slot.booking_date)).getTime())
      )
    ).map(ts => new Date(ts));
    console.log("Unique dates:", uniqueDates.length);
    return uniqueDates;
  }, [allTimeslots]);

  // Handler for when a guest wants to request a booking
  const handleGuestBooking = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedTimeslotId || !selectedInfrastructure) {
      setMessage({
        type: 'error',
        text: t('bookTimeslot.msgErrInf&Ts', 'Please select a valid infrastructure and timeslot')
      });
      return;
    }

    if (!guestName.trim()) {
      setMessage({
        type: 'error',
        text: t('bookTimeslot.msgErrName', 'Please enter your name')
      });
      return;
    }

    if (!guestEmail.trim()) {
      setMessage({
        type: 'error',
        text: t('bookTimeslot.msgErrEmailEmpt', 'Please enter your email address')
      });
      return;
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(guestEmail)) {
      setMessage({
        type: 'error',
        text: t('bookTimeslot.msgErrEmailInvalid', 'Please enter a valid email address')
      });
      return;
    }

    setIsProcessingGuestBooking(true);
    setMessage(null);

    try {
      const result = await requestBooking(
        selectedTimeslotId,
        purpose,
        answers,
        { name: guestName, email: guestEmail },
        selectedInfrastructure.id
      );

      if (result.success) {
        setMessage({
          type: 'success',
          text: result.message /* todo resolve transtlation of text coming from server */
        });

        resetForm();
        setSelectedInfrastructure(null);

        // Redirect to login page after a delay
        setTimeout(() => {
          navigate(LOGIN);
        }, ALERT_MESSAGE_TIME);
      } else {
        setMessage({
          type: 'error',
          text: result.message
        });
      }
    } catch (error) {
      console.error('Error processing guest booking:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : t('bookTimeslot.msgErrGuestBook')
        // 'An error occurred while processing your booking'
      });
    } finally {
      setIsProcessingGuestBooking(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedTimeslotId || !selectedInfrastructure) {
      setMessage({
        type: 'error',
        text: t('bookTimeslot.msgErrInfTimeUnselected', 'Please select an infrastructure and timeslot')
      });
      return;
    }

    // For guest mode, show email form instead of proceeding directly
    if (isGuestMode) {
      setShowGuestEmailForm(true);
      return;
    }

    // Regular booking flow for authenticated users
    try {
      setIsLoading(true);

      const result = await requestBooking(
        selectedTimeslotId,
        purpose,
        answers
      );

      if (result.success) {
        setMessage({
          type: 'success',
          text: t('bookTimeslot.msgSucBookReqSubmit', 'Your booking request has been submitted successfully!')
        });

        resetForm();
        setSelectedInfrastructure(null);

        setTimeout(() => {
          window.location.reload();
        }, ALERT_MESSAGE_TIME);
      } else {
        setMessage({
          type: 'error',
          text: result.message
        });
      }
    } catch (error) {
      console.error('Error creating booking:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : t('bookTimeslot.msgErrBookCreate', 'An error occurred while creating your booking')
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Check if a date should be disabled in the calendar
  const isDateDisabled = (date: Date) => {
    // If no infrastructure is selected or no timeslots are available, disable future dates
    if (!selectedInfrastructure || allTimeslots.length === 0) return true;

    // Disable dates in the past
    const today = startOfDay(new Date());
    if (isBefore(date, today)) return true;

    // If we're still loading timeslots, disable future dates
    if (isLoadingTimeslots) return true;
    const isAvailable = availableDates.some(d => d.getTime() === date.getTime());
    return !isAvailable;
  };

  // Handle infrastructure selection from the InfrastructureSelector
  const handleInfrastructureSelected = (infrastructure: Infrastructure) => {
    if (!selectedInfrastructure || selectedInfrastructure.id !== infrastructure.id) {
      resetForm();
      setSelectedInfrastructure(infrastructure);
    }
  };

  // Render dynamic question fields
  const renderQuestionFields = () => {
    return questions.map(q => (
      <div key={q.id} className="space-y-2">
        <p dir='auto' className="small-title">
          {q.question_text}
          {q.is_required == true && <span className="text-red-500 ml-1">*</span>}
        </p>

        {q.question_type === 'text' && (
          <Textarea
            value={answers[q.id]?.toString() || ''}
            onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })}
            required={q.is_required}
            dir='auto'
          />
        )}

        {q.question_type === 'number' && (
          <Input
            type="number"
            value={answers[q.id]?.toString() || ''}
            onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })}
            required={q.is_required}
          />
        )}

        {q.question_type === 'dropdown' && q.options && (
          <Select
            value={answers[q.id]?.toString() || ''}
            onValueChange={value => setAnswers({ ...answers, [q.id]: value })}
          >
            <SelectTrigger dir='auto'>
              <SelectValue placeholder={t('bookTimeslot.Select an option')} />
            </SelectTrigger>
            <SelectContent>
              {q.options.split('\n').map((option, i) => (
                <SelectItem dir='auto' key={i} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {q.question_type === 'document' && (
          <div>
            <Input
              type="file"
              onChange={e => {
                const file = e.target.files?.[0] || null;
                setAnswers({ ...answers, [q.id]: file });
              }}
              required={q.is_required}
            />
            {answers[q.id] instanceof File && (
              <p className="text-sm text-gray-400 mt-1">
                Selected: {(answers[q.id] as File).name}
              </p>
            )}
          </div>
        )}
      </div>
    ));
  };

  // Resets form and answers
  const resetForm = () => {
    setSelectedDate(undefined);
    setSelectedTimeslotId(undefined);
    setPurpose('');
    setShowGuestEmailForm(false);

    const initialAnswers: BookingReqAnswersMap = {};
    questions.forEach(q => {
      initialAnswers[q.id] = q.question_type === 'document' ? null : '';
    });
    setAnswers(initialAnswers);
  }

  return (
    <BasePageLayout
      pageTitle={t('bookTimeslot.Request a Booking', "Request a Booking")}
      explanationText={isGuestMode
        ? t('bookTimeslot.bookReqGuestExplain')
        // "As a guest, you can request a booking without an account, but limited to one request per day."
        : t('bookTimeslot.bookReqUserExplain', "Fill and submit the form to request a booking")}
      showDashboardButton={!isGuestMode}
      showLogoutButton={isGuestMode}
      isGuest={isGuestMode}
      alertMessage={message}
      alertMessageTimer={ALERT_MESSAGE_TIME}
      className={"w-150"}
    >
      {showGuestEmailForm ? (
        <Card className="card1 max-w-md mx-auto">
          <CardContent className="p-6">
            <div className="flex justify-center mb-4">
              <Mail className="h-8 w-8 text-blue-500 mr-3" />
              <h2 className="text-xl font-bold">{t('bookTimeslot.Confirm Your Email', 'Confirm Your Email')}</h2>
            </div>

            <p className="mb-4 explanation-text1">
              {t('bookTimeslot.emailExplain')}
              {/* Please enter your email address. You'll receive a confirmation link to finalize your booking. */}
            </p>

            <form onSubmit={handleGuestBooking} className="space-y-4">
              <div className="space-y-2">
                <label className="block mb-1">Name</label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder={t("Enter your name")}
                  required
                />
              </div>

              <div>
                <label className="block mb-1">Email Address</label>
                <Input
                  type="email"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  placeholder={t("Enter your email address")}
                  required
                />
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  onClick={() => setShowGuestEmailForm(false)}
                  disabled={isProcessingGuestBooking}
                >
                  {t('Back')}
                </Button>

                <Button
                  type="submit"
                  className="flex-1"
                  disabled={isProcessingGuestBooking || !guestEmail || !guestName}
                >
                  {isProcessingGuestBooking ?
                    t('actProcessing') :
                    t('bookTimeslot.Send', { what: t('Confirmation Email') })}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card className="card1 mb-8">
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Infrastructure Selection */}
              <InfrastructureSelector
                onSelectInfrastructure={handleInfrastructureSelected}
                onError={(errorMsg) => setMessage({ type: 'error', text: errorMsg })}
                defaultSelectedInfrast={selectedInfrastructure}
                className="mt-3"
              />

              {/* Date Selection */}
              <div className="space-y-2" dir='auto'>
                <p className="small-title">{t('Select Date')}</p>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={`def-hover w-full h-9 px-2 text-[14px] justify-start text-left font-normal 
                        ${!selectedDate && "text-gray-400"}`}
                      disabled={!selectedInfrastructure}
                    >
                      <CalendarCheck className="mr-2 h-4 w-4" />
                      {selectedDate ? formatDate(selectedDate, i18n.language) : t("Select a date")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="calendar-popover">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(date) => {
                        setSelectedDate(date);
                        setSelectedTimeslotId(undefined); // Reset timeslot when date changes
                      }}
                      disabled={isDateDisabled}
                    />

                  </PopoverContent>
                </Popover>
                {isLoadingTimeslots && <p className="text-sm text-gray-400">{t('bookTimeslot.Loading available dates', 'Loading available dates...')}</p>}
                {!isLoadingTimeslots && selectedInfrastructure && availableDates.length === 0 && (
                  <p className="text-sm text-amber-500">{t('bookTimeslot.noTimeSlots')}</p>
                  // No available timeslots for this infrastructure
                )}
              </div>

              {/* Timeslot Selection */}
              <div className="space-y-2">
                <p className="small-title">{t('bookTimeslot.Select Timeslot', 'Select Timeslot')}</p>
                <Select
                  onValueChange={(value) => setSelectedTimeslotId(Number(value))}
                  value={selectedTimeslotId?.toString() || ""}
                  disabled={selectedDateTimeslots.length === 0 || !selectedDate}
                >
                  <SelectTrigger id="timeslot" dir='auto'>
                    <SelectValue placeholder={
                      !selectedInfrastructure
                        ? t('bookTimeslot.Select infrastructure first') : !selectedDate
                          ? t('bookTimeslot.Select a date first') : selectedDateTimeslots.length === 0
                            ? t('bookTimeslot.noTsForDate', 'No available timeslots for this date') :
                            t("bookTimeslot.Select a timeslot")
                    } />
                  </SelectTrigger>
                  <SelectContent className="card1">
                    {selectedDateTimeslots.map((slot) => (
                      <SelectItem key={slot.id} value={slot.id.toString()}>
                        {formatTimeString(slot.start_time)} - {formatTimeString(slot.end_time)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Purpose */}
              <div className="space-y-2">
                <p className="small-title">{t('bookTimeslot.bookPurposeTitle', 'Purpose of Booking (optional)')}</p>
                <Textarea
                  id="purpose"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder={t('bookTimeslot.bookPurposeDesc', "Briefly describe the purpose of your booking")}
                  className="h-24"
                  dir={purpose.trim() !== '' ? 'auto' : i18n.dir()}
                />
              </div>

              {/* Dynamic question fields */}
              {questions.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium">{t('bookTimeslot.Additional Information')}</h3>
                  {renderQuestionFields()}
                </div>
              )}

              {/* Submit button - updated for guest mode */}
              {isGuestMode && (
                <Alert className="bg-gray-800 border border-gray-700">
                  <AlertDescription>
                    <p dir='auto'>{t('bookTimeslot.submmitionExplainstart')}</p>
                    {/* As a guest, after filling and submitting this form: */}
                    <p dir='auto'>&nbsp;&nbsp;&nbsp;{t('bookTimeslot.submmitionExplain1', "1. You'll be asked for your email address.")}</p>
                    <p dir='auto'>&nbsp;&nbsp;&nbsp;{t('bookTimeslot.submmitionExplain2', "2. We'll send you an email with a confirmation link.")}</p>
                    <p dir='auto'>&nbsp;&nbsp;&nbsp;{t('bookTimeslot.submmitionExplain3', '3. Click the link to finalize your booking request.')}</p>
                  </AlertDescription>
                </Alert>
              )}
              <Button
                type="submit"
                disabled={!isFormValid || isLoading}
                className="w-full"
              >
                {isGuestMode ? (
                  <>
                    {t('bookTimeslot.Continue to Verification')}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                ) : (t('bookTimeslot.Submit Booking Request'))
                }
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </BasePageLayout>
  );
};

export default BookTimeslot;