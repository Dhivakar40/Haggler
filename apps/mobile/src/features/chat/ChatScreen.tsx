import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SOCKET_EVENTS } from '@haggler/shared';
import { getMessages, getThread, sendMessageRest } from '../../api/market';
import { useSession } from '../../auth/session';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Text,
  TextField,
} from '../../components';
import { useRealtime } from '../../realtime/RealtimeProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { radii, spacing } from '../../theme/tokens';

interface Pending {
  clientMsgId: string;
  body: string;
  failed: boolean;
}

/**
 * In-app chat (real numbers are never shared). Messages are saved on the server first; the live
 * socket only delivers them faster. A retry of the same clientMsgId can never duplicate a message.
 */
export function ChatScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const realtime = useRealtime();
  const me = useSession((s) => s.user?.id);
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const thread = useQuery({
    queryKey: ['thread', jobId],
    queryFn: () => getThread(jobId as string),
    enabled: !!jobId,
  });
  const threadId = thread.data?.id;
  const messages = useInfiniteQuery({
    queryKey: ['messages', threadId],
    queryFn: ({ pageParam }) => getMessages(threadId as string, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!threadId,
    refetchInterval: 15_000, // safety net if the socket drops
  });
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);

  async function deliver(p: Pending) {
    try {
      let ok = false;
      if (realtime?.isConnected()) {
        try {
          const ack = await realtime.emitWithAck<{ ok: boolean }>(SOCKET_EVENTS.chat, {
            threadId,
            clientMsgId: p.clientMsgId,
            body: p.body,
          });
          ok = ack?.ok === true;
        } catch {
          ok = false;
        }
      }
      if (!ok)
        await sendMessageRest(threadId as string, { clientMsgId: p.clientMsgId, body: p.body });
      setPending((cur) => cur.filter((x) => x.clientMsgId !== p.clientMsgId));
      await qc.invalidateQueries({ queryKey: ['messages', threadId] });
    } catch {
      setPending((cur) =>
        cur.map((x) => (x.clientMsgId === p.clientMsgId ? { ...x, failed: true } : x)),
      );
    }
  }

  function send() {
    const body = text.trim();
    if (!body || !threadId) return;
    const p: Pending = { clientMsgId: Crypto.randomUUID(), body, failed: false };
    setText('');
    setPending((cur) => [...cur, p]);
    void deliver(p);
  }

  if (thread.isLoading)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  if (thread.isError || !threadId)
    return (
      <Screen>
        <ErrorState onRetry={() => void thread.refetch()} />
      </Screen>
    );

  const saved = messages.data?.pages.flatMap((p) => p.items) ?? [];
  // Newest first for an inverted list; unsent messages sit at the bottom (newest).
  const rows = [
    ...[...pending].reverse().map((p) => ({ kind: 'pending' as const, ...p })),
    ...saved.map((m) => ({ kind: 'saved' as const, ...m })),
  ];

  return (
    <Screen>
      <FlatList
        style={{ flex: 1 }}
        inverted
        data={rows}
        keyExtractor={(r) => (r.kind === 'pending' ? `p-${r.clientMsgId}` : r.id)}
        onEndReached={() => messages.hasNextPage && void messages.fetchNextPage()}
        ListEmptyComponent={<EmptyState message={t('chat.empty')} />}
        renderItem={({ item }) => {
          const mine = item.kind === 'pending' || item.senderId === me;
          const failed = item.kind === 'pending' && item.failed;
          return (
            <Pressable
              testID={
                item.kind === 'pending' ? `msg-pending-${item.clientMsgId}` : `msg-${item.id}`
              }
              disabled={!failed}
              onPress={() =>
                item.kind === 'pending' &&
                void deliver({ clientMsgId: item.clientMsgId, body: item.body, failed: false })
              }
              style={[
                styles.bubble,
                mine ? styles.mine : styles.theirs,
                {
                  backgroundColor: mine ? colors.primary : colors.surfaceAlt,
                  opacity: item.kind === 'pending' && !failed ? 0.6 : 1,
                },
              ]}
            >
              <Text style={{ color: mine ? colors.onPrimary : colors.text }}>{item.body}</Text>
              {failed ? (
                <Text variant="caption" style={{ color: mine ? colors.onPrimary : colors.danger }}>
                  {t('chat.notSent')}
                </Text>
              ) : null}
            </Pressable>
          );
        }}
      />
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <TextField
            testID="chat-input"
            label={t('chat.placeholder')}
            value={text}
            onChangeText={setText}
            maxLength={2000}
            multiline
          />
        </View>
        <Button testID="chat-send" title={t('chat.send')} onPress={send} disabled={!text.trim()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: '80%',
    padding: spacing.md,
    borderRadius: radii.lg,
    marginVertical: spacing.xs,
    gap: 2,
  },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
});
