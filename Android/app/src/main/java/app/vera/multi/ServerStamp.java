package app.vera.multi;

import android.content.Context;
import android.net.Uri;

import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

/**
 * Server address written into the APK at download time (Server/download-stamp.js).
 *
 * The site and the app must point to the same server: when the APK is downloaded
 * from https://xxx.trycloudflare.com, the server puts that address into an extra
 * entry (ID 'VERA') of the APK Signing Block. The signature does not cover that
 * block, so the APK still installs. If there is no entry, BuildConfig.SERVER_URL is used.
 */
final class ServerStamp {
    private static final int STAMP_ID = 0x56455241; // 'VERA'
    private static final int EOCD_SIG = 0x06054b50;
    private static final byte[] MAGIC = "APK Sig Block 42".getBytes(StandardCharsets.US_ASCII);
    private static final int MAX_BLOCK = 4 * 1024 * 1024;

    private ServerStamp() {}

    static String resolve(Context ctx) {
        String stamped = null;
        try {
            stamped = read(ctx.getApplicationInfo().sourceDir);
        } catch (Exception ignored) { /* no stamp — use the build address */ }
        return stamped != null ? stamped : BuildConfig.SERVER_URL;
    }

    static String read(String apkPath) throws Exception {
        try (RandomAccessFile f = new RandomAccessFile(apkPath, "r")) {
            long len = f.length();
            int tailLen = (int) Math.min(len, 0xffff + 22);
            ByteBuffer tail = readAt(f, len - tailLen, tailLen);
            int eocd = -1;
            for (int i = tailLen - 22; i >= 0; i--) {
                if (tail.getInt(i) == EOCD_SIG && i + 22 + (tail.getShort(i + 20) & 0xffff) == tailLen) { eocd = i; break; }
            }
            if (eocd < 0) return null;
            long cdOffset = tail.getInt(eocd + 16) & 0xffffffffL;
            if (cdOffset < 32) return null;

            ByteBuffer footer = readAt(f, cdOffset - 24, 24);
            for (int i = 0; i < MAGIC.length; i++) if (footer.get(8 + i) != MAGIC[i]) return null;
            long size = footer.getLong(0);
            if (size < 24 || size > MAX_BLOCK || cdOffset - size - 8 < 0) return null;

            ByteBuffer block = readAt(f, cdOffset - size - 8, (int) size + 8);
            if (block.getLong(0) != size) return null;
            int p = 8;
            int end = block.capacity() - 24;
            while (p + 12 <= end) {
                long pairLen = block.getLong(p);
                if (pairLen < 4 || p + 8 + pairLen > end) return null;
                if (block.getInt(p + 8) == STAMP_ID) {
                    byte[] v = new byte[(int) pairLen - 4];
                    block.position(p + 12);
                    block.get(v);
                    return normalize(new String(v, StandardCharsets.UTF_8));
                }
                p += 8 + (int) pairLen;
            }
            return null;
        }
    }

    /** Only an http(s) origin, like normalizeServerUrl on the server. */
    static String normalize(String raw) {
        if (raw == null || raw.length() > 300) return null;
        Uri u = Uri.parse(raw.trim());
        String scheme = u.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme)) return null;
        if (u.getHost() == null || u.getHost().isEmpty() || u.getUserInfo() != null) return null;
        return scheme + "://" + u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : "");
    }

    private static ByteBuffer readAt(RandomAccessFile f, long pos, int n) throws Exception {
        byte[] b = new byte[n];
        f.seek(pos);
        f.readFully(b);
        return ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN);
    }
}
