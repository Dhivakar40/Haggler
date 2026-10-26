import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import {
  MAX_STUDENT_SKILLS,
  YEARS_OF_STUDY,
  type StudentProfileDto,
  type YearOfStudy,
} from '@haggler/shared';
import {
  createStudentProfile,
  getStudentProfile,
  updateStudentProfileDetails,
  useStudentProfile,
} from '../../api/campus';
import { Button, Card, Chip, Screen, Text, TextField } from '../../components';
import { type DobParts, partsToDob } from '../../lib/dob';
import { errorMessage } from '../../lib/errors';
import { showToast } from '../../store/toast-queue';
import { spacing } from '../../theme/tokens';

/** Set a date of birth once (D-060: hard 18+ block, self-declared but enforced in code, not
 * admin-reviewed like a Ranger's — D-063 known gap). Required once before applying to a Campus
 * job. D-103: everything else (course, year, skills, availability, bio, portfolio) is collected
 * here too, and — unlike the date of birth — can be edited any time afterward. */
export function StudentProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const profile = useStudentProfile(true);
  const [dob, setDob] = useState<DobParts>({ day: '', month: '', year: '' });
  const [institute, setInstitute] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const dateOfBirth = partsToDob(dob);

  async function save() {
    if (!dateOfBirth) return setError(t('onboarding.dobInvalid'));
    setError(undefined);
    setBusy(true);
    try {
      await createStudentProfile({
        dateOfBirth,
        instituteName: institute.trim() || undefined,
      });
      await qc.invalidateQueries({ queryKey: ['student', 'profile'] });
      router.push('/campus');
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (profile.data) {
    return <StudentDetailsEditor profile={profile.data} />;
  }

  return (
    <Screen scroll>
      <Text color="textMuted">{t('campus.profileIntro')}</Text>
      <Card>
        <View style={{ gap: spacing.md }}>
          <View style={{ gap: spacing.sm }}>
            <Text variant="label">{t('campus.dateOfBirth')}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <TextField
                  testID="student-dob-day"
                  label={t('onboarding.dobDay')}
                  value={dob.day}
                  onChangeText={(v) => setDob({ ...dob, day: v.replace(/\D/g, '').slice(0, 2) })}
                  keyboardType="number-pad"
                  maxLength={2}
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  testID="student-dob-month"
                  label={t('onboarding.dobMonth')}
                  value={dob.month}
                  onChangeText={(v) => setDob({ ...dob, month: v.replace(/\D/g, '').slice(0, 2) })}
                  keyboardType="number-pad"
                  maxLength={2}
                />
              </View>
              <View style={{ flex: 1.4 }}>
                <TextField
                  testID="student-dob-year"
                  label={t('onboarding.dobYear')}
                  value={dob.year}
                  onChangeText={(v) => setDob({ ...dob, year: v.replace(/\D/g, '').slice(0, 4) })}
                  keyboardType="number-pad"
                  maxLength={4}
                />
              </View>
            </View>
          </View>
          <TextField
            testID="student-institute"
            label={t('campus.instituteName')}
            value={institute}
            onChangeText={setInstitute}
            maxLength={120}
          />
          {error ? (
            <Text color="danger" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Button
            testID="student-save-profile"
            title={t('common.save')}
            onPress={() => void save()}
            loading={busy}
          />
        </View>
      </Card>
    </Screen>
  );
}

/** D-103: the rich, editable profile shown once the (immutable) date of birth is on file. Every
 * field here is optional and independently saveable — a thin profile still works for applying
 * to jobs, this is what makes a complete one worth filling in. */
function StudentDetailsEditor({ profile }: { profile: StudentProfileDto }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [institute, setInstitute] = useState(profile.instituteName ?? '');
  const [course, setCourse] = useState(profile.courseOfStudy ?? '');
  const [year, setYear] = useState<YearOfStudy | null>(profile.yearOfStudy);
  const [skills, setSkills] = useState<string[]>(profile.skills);
  const [skillInput, setSkillInput] = useState('');
  const [hours, setHours] = useState(
    profile.availabilityHoursPerWeek ? String(profile.availabilityHoursPerWeek) : '',
  );
  const [bio, setBio] = useState(profile.bio ?? '');
  const [portfolioUrl, setPortfolioUrl] = useState(profile.portfolioUrl ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setInstitute(profile.instituteName ?? '');
    setCourse(profile.courseOfStudy ?? '');
    setYear(profile.yearOfStudy);
    setSkills(profile.skills);
    setHours(profile.availabilityHoursPerWeek ? String(profile.availabilityHoursPerWeek) : '');
    setBio(profile.bio ?? '');
    setPortfolioUrl(profile.portfolioUrl ?? '');
  }, [profile]);

  function addSkill() {
    const v = skillInput.trim();
    if (!v || skills.length >= MAX_STUDENT_SKILLS || skills.includes(v)) return;
    setSkills([...skills, v]);
    setSkillInput('');
  }

  function removeSkill(skill: string) {
    setSkills(skills.filter((s) => s !== skill));
  }

  async function save() {
    setError(undefined);
    const trimmedUrl = portfolioUrl.trim();
    if (trimmedUrl && !/^https?:\/\//.test(trimmedUrl)) {
      return setError(t('campus.portfolioUrlInvalid'));
    }
    const parsedHours = hours.trim() ? Number(hours) : undefined;
    setBusy(true);
    try {
      await updateStudentProfileDetails({
        instituteName: institute.trim() || undefined,
        courseOfStudy: course.trim() || undefined,
        yearOfStudy: year ?? undefined,
        skills,
        availabilityHoursPerWeek: parsedHours,
        bio: bio.trim() || undefined,
        portfolioUrl: trimmedUrl || undefined,
      });
      await qc.invalidateQueries({ queryKey: ['student', 'profile'] });
      showToast(t('campus.profileSaved'));
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Text variant="title">{t('campus.profileTitle')}</Text>
      <Card>
        <View style={{ gap: spacing.md }}>
          <TextField
            testID="student-institute"
            label={t('campus.instituteName')}
            value={institute}
            onChangeText={setInstitute}
            maxLength={120}
          />
          <TextField
            testID="student-course"
            label={t('campus.courseOfStudy')}
            value={course}
            onChangeText={setCourse}
            maxLength={120}
          />
          <View style={{ gap: spacing.sm }}>
            <Text variant="label">{t('campus.yearOfStudy')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {YEARS_OF_STUDY.map((y) => (
                <Chip
                  key={y}
                  testID={`student-year-${y}`}
                  label={t(`campus.year.${y}`)}
                  selected={year === y}
                  onPress={() => setYear(year === y ? null : y)}
                />
              ))}
            </View>
          </View>
        </View>
      </Card>

      <Card>
        <View style={{ gap: spacing.sm }}>
          <Text variant="heading">{t('campus.skills')}</Text>
          <Text color="textMuted">{t('campus.skillsHint')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {skills.map((skill) => (
              <Chip
                key={skill}
                testID={`student-skill-${skill}`}
                label={skill}
                selected
                onPress={() => removeSkill(skill)}
              />
            ))}
          </View>
          {skills.length < MAX_STUDENT_SKILLS ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}>
                <TextField
                  testID="student-skill-input"
                  label={t('campus.addSkillPlaceholder')}
                  value={skillInput}
                  onChangeText={setSkillInput}
                  maxLength={40}
                />
              </View>
              <Button
                testID="student-add-skill"
                variant="secondary"
                title={t('campus.addSkill')}
                onPress={addSkill}
                disabled={!skillInput.trim()}
              />
            </View>
          ) : null}
        </View>
      </Card>

      <Card>
        <View style={{ gap: spacing.sm }}>
          <Text variant="heading">{t('campus.availability')}</Text>
          <Text color="textMuted">{t('campus.availabilityHint')}</Text>
          <TextField
            testID="student-hours"
            label={t('campus.hoursPerWeekLabel')}
            value={hours}
            onChangeText={(v) => setHours(v.replace(/\D/g, '').slice(0, 2))}
            keyboardType="number-pad"
            maxLength={2}
          />
        </View>
      </Card>

      <Card>
        <View style={{ gap: spacing.sm }}>
          <Text variant="heading">{t('campus.bio')}</Text>
          <TextField
            testID="student-bio"
            label={t('campus.bio')}
            value={bio}
            onChangeText={setBio}
            maxLength={500}
            multiline
          />
          <TextField
            testID="student-portfolio"
            label={t('campus.portfolioUrl')}
            value={portfolioUrl}
            onChangeText={setPortfolioUrl}
            autoCapitalize="none"
            maxLength={300}
          />
        </View>
      </Card>

      {error ? (
        <Text color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button
        testID="student-save-details"
        title={t('common.save')}
        onPress={() => void save()}
        loading={busy}
      />
    </Screen>
  );
}

/** Best-effort check used by AccountScreen, without needing a dedicated existence endpoint. */
export async function hasStudentProfile(): Promise<boolean> {
  try {
    await getStudentProfile();
    return true;
  } catch {
    return false;
  }
}
