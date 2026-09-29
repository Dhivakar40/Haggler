import {
  AudioQuality,
  IOSOutputFormat,
  type RecordingOptions,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { MAX_VOICE_SECONDS } from '@haggler/shared';
import { Button, Text } from '../../components';
import { spacing } from '../../theme/tokens';

/** Mono, 22 kHz, 32 kbps AAC: speech-clear and about 240 KB per minute (low-bandwidth friendly). */
export const VOICE_OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 32000,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MEDIUM },
  web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
};

export interface VoiceNote {
  uri: string;
  durationSeconds: number;
}

interface Props {
  value: VoiceNote | null;
  onChange: (note: VoiceNote | null) => void;
}

/** Record up to 60 seconds. It stops by itself at the limit so a request can never carry a longer note. */
export function VoiceNoteRecorder({ value, onChange }: Props) {
  const { t } = useTranslation();
  const recorder = useAudioRecorder(VOICE_OPTIONS);
  const state = useAudioRecorderState(recorder, 500);
  const [denied, setDenied] = useState(false);
  const seconds = Math.floor((state.durationMillis ?? 0) / 1000);

  async function start() {
    setDenied(false);
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) return setDenied(true);
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function stop() {
    const secs = Math.max(
      1,
      Math.min(MAX_VOICE_SECONDS, Math.ceil((state.durationMillis ?? 0) / 1000)),
    );
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false });
    if (recorder.uri) onChange({ uri: recorder.uri, durationSeconds: secs });
  }

  useEffect(() => {
    if (state.isRecording && seconds >= MAX_VOICE_SECONDS) void stop();
  }, [state.isRecording, seconds]);

  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="label">{t('request.voice')}</Text>
      {value ? (
        <View
          style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Text testID="voice-ready" color="success">
            {t('request.voiceReady', { seconds: value.durationSeconds })}
          </Text>
          <Button
            testID="voice-remove"
            variant="secondary"
            title={t('request.removePhoto')}
            onPress={() => onChange(null)}
          />
        </View>
      ) : state.isRecording ? (
        <View style={{ gap: spacing.sm }}>
          <Text testID="voice-recording" color="danger">
            {t('request.recording', { seconds })}
          </Text>
          <Button
            testID="voice-stop"
            variant="danger"
            title={t('request.stop')}
            onPress={() => void stop()}
          />
        </View>
      ) : (
        <Button
          testID="voice-record"
          variant="secondary"
          title={t('request.record')}
          onPress={() => void start()}
        />
      )}
      {denied ? (
        <Text color="danger" accessibilityRole="alert">
          {t('request.micDenied')}
        </Text>
      ) : null}
    </View>
  );
}
