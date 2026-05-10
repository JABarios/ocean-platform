declare module 'web-push' {
  interface PushKeys {
    p256dh: string
    auth: string
  }

  interface PushSubscription {
    endpoint: string
    keys: PushKeys
  }

  interface NotificationOptions {
    TTL?: number
    vapidDetails?: {
      subject: string
      publicKey: string
      privateKey: string
    }
  }

  interface WebPushModule {
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void
    sendNotification(subscription: PushSubscription, payload?: string, options?: NotificationOptions): Promise<void>
  }

  const webpush: WebPushModule
  export default webpush
}
