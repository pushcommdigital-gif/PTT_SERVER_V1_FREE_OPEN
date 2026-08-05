package com.pushcomm.ptt

import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.TimeUnit

class PushcommUnauthorizedException(message: String = "Unauthorized") : IllegalStateException(message)

class PushcommApi {
  private val client = OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(20, TimeUnit.SECONDS)
    .build()

  private val moshi = Moshi.Builder()
    .add(KotlinJsonAdapterFactory())
    .build()
  private val jsonType = "application/json; charset=utf-8".toMediaType()

  private fun throwUnauthorizedIfNeeded(code: Int, error: String?) {
    if (code == 401 || error.equals("Unauthorized", ignoreCase = true)) {
      throw PushcommUnauthorizedException(error ?: "Unauthorized")
    }
  }

  suspend fun refreshTokens(baseUrl: String, refreshToken: String): RefreshData = withContext(Dispatchers.IO) {
    val payload = moshi.adapter(RefreshPayload::class.java).toJson(RefreshPayload(refreshToken))
    val req = Request.Builder()
      .url("$baseUrl/api/auth/refresh")
      .post(payload.toRequestBody(jsonType))
      .build()

    client.newCall(req).execute().use { res ->
      val body = res.body?.string().orEmpty()
      val type = Types.newParameterizedType(ApiEnvelope::class.java, RefreshData::class.java)
      val envelope = moshi.adapter<ApiEnvelope<RefreshData>>(type).fromJson(body)
      if (!res.isSuccessful || envelope?.success != true || envelope.data == null) {
        // A 401 means the refresh token itself is rejected (genuine session end).
        // Any other failure (network/5xx) is transient — callers keep the session.
        if (res.code == 401) throw PushcommUnauthorizedException(envelope?.error ?: "Refresh token rejected")
        throw IllegalStateException(envelope?.error ?: "Token refresh failed (${res.code})")
      }
      envelope.data
    }
  }

  suspend fun login(baseUrl: String, usernameOrEmail: String, password: String): LoginData = withContext(Dispatchers.IO) {
    val payload = moshi.adapter(LoginPayload::class.java).toJson(LoginPayload(usernameOrEmail, password))
    val req = Request.Builder()
      .url("$baseUrl/api/auth/login")
      .post(payload.toRequestBody(jsonType))
      .build()

    client.newCall(req).execute().use { res ->
      val body = res.body?.string().orEmpty()
      val type = Types.newParameterizedType(ApiEnvelope::class.java, LoginData::class.java)
      val envelope = try {
        moshi.adapter<ApiEnvelope<LoginData>>(type).fromJson(body)
      } catch (e: Exception) {
        throw IllegalStateException("Server unreachable or returned an invalid response (${res.code})")
      }
      if (!res.isSuccessful || envelope?.success != true || envelope.data == null) {
        // 401/invalid-credentials → PushcommUnauthorizedException so callers
        // (silent re-login) can tell a rejected password from a network error.
        throwUnauthorizedIfNeeded(res.code, envelope?.error)
        throw IllegalStateException(envelope?.error ?: "Login failed (${res.code})")
      }
      envelope.data
    }
  }

  /**
   * Verify the admin logout PIN against the server (department setting). The PIN
   * is never stored on the device — the entered value is sent and the server
   * answers valid/invalid. Throws on a network/server error so the caller can
   * distinguish "wrong PIN" from "couldn't reach the server".
   */
  suspend fun verifyAdminPin(baseUrl: String, accessToken: String, pin: String): Boolean = withContext(Dispatchers.IO) {
    val json = moshi.adapter(Map::class.java).toJson(mapOf("pin" to pin))
    val req = Request.Builder()
      .url("$baseUrl/api/settings/verify-pin")
      .addHeader("Authorization", "Bearer $accessToken")
      .post(json.toRequestBody(jsonType))
      .build()
    client.newCall(req).execute().use { res ->
      val body = res.body?.string().orEmpty()
      val obj = org.json.JSONObject(body.ifBlank { "{}" })
      if (!res.isSuccessful || !obj.optBoolean("success", false)) {
        throw IllegalStateException(obj.optString("error").ifBlank { "PIN check failed (${res.code})" })
      }
      obj.optJSONObject("data")?.optBoolean("valid", false) ?: false
    }
  }

  suspend fun provisionDevice(baseUrl: String, code: String): LoginData = withContext(Dispatchers.IO) {
    val payload = moshi.adapter(ProvisionPayload::class.java).toJson(ProvisionPayload(code))
    val req = Request.Builder()
      .url("$baseUrl/api/devices/provision")
      .post(payload.toRequestBody(jsonType))
      .build()

    client.newCall(req).execute().use { res ->
      val body = res.body?.string().orEmpty()
      val type = Types.newParameterizedType(ApiEnvelope::class.java, LoginData::class.java)
      val envelope = try {
        moshi.adapter<ApiEnvelope<LoginData>>(type).fromJson(body)
      } catch (e: Exception) {
        throw IllegalStateException("Server unreachable or returned an invalid response (${res.code})")
      }
      if (!res.isSuccessful || envelope?.success != true || envelope.data == null) {
        throw IllegalStateException(envelope?.error ?: "Provisioning failed (${res.code})")
      }
      envelope.data
    }
  }

  suspend fun listGroups(baseUrl: String, accessToken: String): List<GroupItem> = withContext(Dispatchers.IO) {
    val req = Request.Builder()
      .url("$baseUrl/api/groups?limit=200")
      .addHeader("Authorization", "Bearer $accessToken")
      .get()
      .build()

    client.newCall(req).execute().use { res ->
      val body = res.body?.string().orEmpty()
      val listType = Types.newParameterizedType(List::class.java, GroupItem::class.java)
      val envelopeType = Types.newParameterizedType(ApiEnvelope::class.java, listType)
      val envelope = moshi.adapter<ApiEnvelope<List<GroupItem>>>(envelopeType).fromJson(body)
      if (!res.isSuccessful || envelope?.success != true || envelope.data == null) {
        throw IllegalStateException(envelope?.error ?: "Load groups failed (${res.code})")
      }
      envelope.data
    }
  }

  suspend fun getPrivateCallToken(
    baseUrl: String,
    accessToken: String,
    targetUserId: String,
    notify: Boolean,
  ): VoiceTokenData = withContext(Dispatchers.IO) {
    val payload = buildMap<String, Any> {
      put("targetUserId", targetUserId)
      put("notify", notify)
    }
    val json = moshi.adapter(Map::class.java).toJson(payload)
    val req = Request.Builder()
      .url("$baseUrl/api/private-calls/token")
      .addHeader("Authorization", "Bearer $accessToken")
      .post(json.toRequestBody(jsonType))
      .build()

    client.newCall(req).execute().use { res ->
      val body = res.body?.string().orEmpty()
      val type = Types.newParameterizedType(ApiEnvelope::class.java, VoiceTokenData::class.java)
      val envelope = moshi.adapter<ApiEnvelope<VoiceTokenData>>(type).fromJson(body)
      if (!res.isSuccessful || envelope?.success != true || envelope.data == null) {
        throw IllegalStateException(envelope?.error ?: "Private call token request failed (${res.code})")
      }
      envelope.data
    }
  }

  suspend fun endPrivateCall(baseUrl: String, accessToken: String, targetUserId: String) = withContext(Dispatchers.IO) {
    val payload = mapOf("targetUserId" to targetUserId)
    val json = moshi.adapter(Map::class.java).toJson(payload)
    val req = Request.Builder()
      .url("$baseUrl/api/private-calls/end")
      .addHeader("Authorization", "Bearer $accessToken")
      .post(json.toRequestBody(jsonType))
      .build()
    client.newCall(req).execute().use { /* fire and forget */ }
  }

  suspend fun requestGroupVoiceToken(baseUrl: String, accessToken: String, groupId: String): VoiceTokenData = withContext(Dispatchers.IO) {
    val req = Request.Builder()
      .url("$baseUrl/api/groups/$groupId/token")
      .addHeader("Authorization", "Bearer $accessToken")
      .post("{}".toRequestBody(jsonType))
      .build()

    client.newCall(req).execute().use { res ->
      val body = res.body?.string().orEmpty()
      val type = Types.newParameterizedType(ApiEnvelope::class.java, VoiceTokenData::class.java)
      val envelope = moshi.adapter<ApiEnvelope<VoiceTokenData>>(type).fromJson(body)
      if (!res.isSuccessful || envelope?.success != true || envelope.data == null) {
        throwUnauthorizedIfNeeded(res.code, envelope?.error)
        throw IllegalStateException(envelope?.error ?: "Token request failed (${res.code})")
      }
      envelope.data
    }
  }

  suspend fun requestBroadcastVoiceToken(baseUrl: String, accessToken: String): VoiceTokenData = withContext(Dispatchers.IO) {
    val req = Request.Builder()
      .url("$baseUrl/api/broadcast/token")
      .addHeader("Authorization", "Bearer $accessToken")
      .post("{}".toRequestBody(jsonType))
      .build()

    client.newCall(req).execute().use { res ->
      val body = res.body?.string().orEmpty()
      val type = Types.newParameterizedType(ApiEnvelope::class.java, VoiceTokenData::class.java)
      val envelope = moshi.adapter<ApiEnvelope<VoiceTokenData>>(type).fromJson(body)
      if (!res.isSuccessful || envelope?.success != true || envelope.data == null) {
        throwUnauthorizedIfNeeded(res.code, envelope?.error)
        throw IllegalStateException(envelope?.error ?: "Broadcast token request failed (${res.code})")
      }
      envelope.data
    }
  }

  suspend fun listUsers(baseUrl: String, accessToken: String): List<UserItem> = withContext(Dispatchers.IO) {
    val req = Request.Builder()
      .url("$baseUrl/api/users?limit=200")
      .addHeader("Authorization", "Bearer $accessToken")
      .get()
      .build()

    client.newCall(req).execute().use { res ->
      val body = res.body?.string().orEmpty()
      val listType = Types.newParameterizedType(List::class.java, UserItem::class.java)
      val envelopeType = Types.newParameterizedType(ApiEnvelope::class.java, listType)
      val envelope = moshi.adapter<ApiEnvelope<List<UserItem>>>(envelopeType).fromJson(body)
      if (!res.isSuccessful || envelope?.success != true || envelope.data == null) {
        throw IllegalStateException(envelope?.error ?: "Load users failed (${res.code})")
      }
      envelope.data
    }
  }

  suspend fun listConversations(baseUrl: String, accessToken: String): ConversationsData = withContext(Dispatchers.IO) {
    val req = Request.Builder()
      .url("$baseUrl/api/messages/conversations")
      .addHeader("Authorization", "Bearer $accessToken")
      .get()
      .build()

    client.newCall(req).execute().use { res ->
      val body = res.body?.string().orEmpty()
      val type = Types.newParameterizedType(ApiEnvelope::class.java, ConversationsData::class.java)
      val envelope = moshi.adapter<ApiEnvelope<ConversationsData>>(type).fromJson(body)
      if (!res.isSuccessful || envelope?.success != true || envelope.data == null) {
        throwUnauthorizedIfNeeded(res.code, envelope?.error)
        throw IllegalStateException(envelope?.error ?: "Load conversations failed (${res.code})")
      }
      envelope.data
    }
  }

  suspend fun listMessages(
    baseUrl: String,
    accessToken: String,
    type: String,
    targetUserId: String? = null,
    targetGroupId: String? = null,
  ): List<MessageData> = withContext(Dispatchers.IO) {
    val params = buildString {
      append("page=1&limit=100&type=$type")
      if (!targetUserId.isNullOrBlank()) append("&targetUserId=$targetUserId")
      if (!targetGroupId.isNullOrBlank()) append("&targetGroupId=$targetGroupId")
    }
    val req = Request.Builder()
      .url("$baseUrl/api/messages?$params")
      .addHeader("Authorization", "Bearer $accessToken")
      .get()
      .build()

    client.newCall(req).execute().use { res ->
      val body = res.body?.string().orEmpty()
      val listType = Types.newParameterizedType(List::class.java, MessageData::class.java)
      val envelopeType = Types.newParameterizedType(ApiEnvelope::class.java, listType)
      val envelope = moshi.adapter<ApiEnvelope<List<MessageData>>>(envelopeType).fromJson(body)
      if (!res.isSuccessful || envelope?.success != true || envelope.data == null) {
        throwUnauthorizedIfNeeded(res.code, envelope?.error)
        throw IllegalStateException(envelope?.error ?: "Load messages failed (${res.code})")
      }
      envelope.data
    }
  }

  suspend fun sendMessage(
    baseUrl: String,
    accessToken: String,
    type: String,
    bodyText: String,
    targetUserId: String? = null,
    targetGroupId: String? = null,
  ) = withContext(Dispatchers.IO) {
    val payload = buildMap<String, Any?> {
      put("type", type)
      put("body", bodyText)
      put("targetUserId", targetUserId)
      put("targetGroupId", targetGroupId)
    }
    val json = moshi.adapter(Map::class.java).toJson(payload)
    val req = Request.Builder()
      .url("$baseUrl/api/messages")
      .addHeader("Authorization", "Bearer $accessToken")
      .post(json.toRequestBody(jsonType))
      .build()

    client.newCall(req).execute().use { res ->
      val body = res.body?.string().orEmpty()
      // Use SimpleResponse (no generic T) — avoids "No JsonAdapter for T" Moshi error
      val envelope = moshi.adapter(SimpleResponse::class.java).fromJson(body)
      if (!res.isSuccessful || envelope == null || envelope.success != true) {
        throwUnauthorizedIfNeeded(res.code, envelope?.error)
        throw IllegalStateException(envelope?.error ?: "Send message failed (${res.code})")
      }
    }
  }

  suspend fun markConversationRead(
    baseUrl: String,
    accessToken: String,
    type: String,
    targetUserId: String? = null,
    targetGroupId: String? = null,
  ) = withContext(Dispatchers.IO) {
    val payload = buildMap<String, Any?> {
      put("type", type)
      put("targetUserId", targetUserId)
      put("targetGroupId", targetGroupId)
    }
    val json = moshi.adapter(Map::class.java).toJson(payload)
    val req = Request.Builder()
      .url("$baseUrl/api/messages/mark-read")
      .addHeader("Authorization", "Bearer $accessToken")
      .patch(json.toRequestBody(jsonType))
      .build()
    client.newCall(req).execute().use { /* fire and forget — ignore errors */ }
  }

  suspend fun postFcmToken(baseUrl: String, accessToken: String, fcmToken: String) = withContext(Dispatchers.IO) {
    val payload = mapOf("token" to fcmToken)
    val json = moshi.adapter(Map::class.java).toJson(payload)
    val req = Request.Builder()
      .url("$baseUrl/api/auth/fcm-token")
      .addHeader("Authorization", "Bearer $accessToken")
      .post(json.toRequestBody(jsonType))
      .build()
    client.newCall(req).execute().use { /* fire and forget */ }
  }

  suspend fun clearFcmToken(baseUrl: String, accessToken: String) = withContext(Dispatchers.IO) {
    val req = Request.Builder()
      .url("$baseUrl/api/auth/fcm-token")
      .addHeader("Authorization", "Bearer $accessToken")
      .delete()
      .build()
    client.newCall(req).execute().use { /* fire and forget */ }
  }

  suspend fun triggerSos(baseUrl: String, accessToken: String, latitude: Double?, longitude: Double?): String = withContext(Dispatchers.IO) {
    val payload = buildMap<String, Any> {
      if (latitude != null) put("latitude", latitude)
      if (longitude != null) put("longitude", longitude)
    }
    val json = moshi.adapter(Map::class.java).toJson(payload)
    val req = Request.Builder()
      .url("$baseUrl/api/sos")
      .addHeader("Authorization", "Bearer $accessToken")
      .post(json.toRequestBody(jsonType))
      .build()
    client.newCall(req).execute().use { response ->
      val body = response.body?.string().orEmpty()
      val obj = org.json.JSONObject(body.ifBlank { "{}" })
      if (!response.isSuccessful || !obj.optBoolean("success", false)) {
        throw IllegalStateException(obj.optString("error").ifBlank { "SOS failed (${response.code})" })
      }
      obj.optJSONObject("data")?.optString("id") ?: ""
    }
  }

  suspend fun cancelSos(baseUrl: String, accessToken: String, sosId: String) = withContext(Dispatchers.IO) {
    val req = Request.Builder()
      .url("$baseUrl/api/sos/$sosId/cancel")
      .addHeader("Authorization", "Bearer $accessToken")
      .post("{}".toRequestBody(jsonType))
      .build()
    client.newCall(req).execute().use { response ->
      val body = response.body?.string().orEmpty()
      val obj = org.json.JSONObject(body.ifBlank { "{}" })
      if (!response.isSuccessful || !obj.optBoolean("success", false)) {
        throw IllegalStateException(obj.optString("error").ifBlank { "Cancel SOS failed (${response.code})" })
      }
    }
  }

  /**
   * Audio Recording v2 — Phase 3B floor handshake.
   *
   * Server is the single source of truth for who holds the floor and
   * spawns LiveKit Egress on grant. Caller must keep mic muted until the
   * response arrives with capture == "started" (or "skipped"); only then
   * unmute. This avoids losing the first syllable while egress spins up.
   */
  suspend fun requestFloor(
    baseUrl: String,
    accessToken: String,
    payload: FloorRequestPayload,
  ): FloorGrantData = withContext(Dispatchers.IO) {
    val body = moshi.adapter(FloorRequestPayload::class.java).toJson(payload)
    val req = Request.Builder()
      .url("$baseUrl/api/voice/floor/request")
      .addHeader("Authorization", "Bearer $accessToken")
      .post(body.toRequestBody(jsonType))
      .build()
    client.newCall(req).execute().use { res ->
      val responseBody = res.body?.string().orEmpty()
      val type = Types.newParameterizedType(ApiEnvelope::class.java, FloorGrantData::class.java)
      val envelope = try {
        moshi.adapter<ApiEnvelope<FloorGrantData>>(type).fromJson(responseBody)
      } catch (e: Exception) {
        throw IllegalStateException("Floor request: invalid response (${res.code})")
      }
      // 409 with success:false + denial details is a normal outcome, not an exception.
      if (res.code == 409 && envelope?.data != null) return@use envelope.data
      if (!res.isSuccessful || envelope?.success != true || envelope.data == null) {
        throw IllegalStateException(envelope?.error ?: "Floor request failed (${res.code})")
      }
      envelope.data
    }
  }

  suspend fun releaseFloor(
    baseUrl: String,
    accessToken: String,
    payload: FloorReleasePayload,
  ) = withContext(Dispatchers.IO) {
    val body = moshi.adapter(FloorReleasePayload::class.java).toJson(payload)
    val req = Request.Builder()
      .url("$baseUrl/api/voice/floor/release")
      .addHeader("Authorization", "Bearer $accessToken")
      .post(body.toRequestBody(jsonType))
      .build()
    // Best-effort: server lease checker auto-releases if we drop this.
    client.newCall(req).execute().use { /* swallow */ }
  }

  suspend fun postLocation(baseUrl: String, accessToken: String, payload: LocationPayload) = withContext(Dispatchers.IO) {
    val json = moshi.adapter(LocationPayload::class.java).toJson(payload)
    val req = Request.Builder()
      .url("$baseUrl/api/locations")
      .addHeader("Authorization", "Bearer $accessToken")
      .post(json.toRequestBody(jsonType))
      .build()
    client.newCall(req).execute().use { /* fire and forget */ }
  }

  /** Store-and-forward flush: upload a batch of buffered fixes. Returns true only on 2xx so the
   *  caller keeps the fixes queued (to retry) on any failure. */
  suspend fun postLocationBatch(baseUrl: String, accessToken: String, fixes: List<LocationFix>): Boolean = withContext(Dispatchers.IO) {
    if (fixes.isEmpty()) return@withContext true
    val json = moshi.adapter(LocationBatchPayload::class.java).toJson(LocationBatchPayload(fixes))
    val req = Request.Builder()
      .url("$baseUrl/api/locations/batch")
      .addHeader("Authorization", "Bearer $accessToken")
      .post(json.toRequestBody(jsonType))
      .build()
    client.newCall(req).execute().use { res -> res.isSuccessful }
  }

  suspend fun getMapOverview(baseUrl: String, accessToken: String): MapOverviewData = withContext(Dispatchers.IO) {
    val req = Request.Builder()
      .url("$baseUrl/api/map/overview")
      .addHeader("Authorization", "Bearer $accessToken")
      .get()
      .build()

    client.newCall(req).execute().use { res ->
      val body = res.body?.string().orEmpty()
      val type = Types.newParameterizedType(ApiEnvelope::class.java, MapOverviewData::class.java)
      val envelope = moshi.adapter<ApiEnvelope<MapOverviewData>>(type).fromJson(body)
      if (!res.isSuccessful || envelope?.success != true || envelope.data == null) {
        throw IllegalStateException(envelope?.error ?: "Map overview failed (${res.code})")
      }
      envelope.data
    }
  }

  suspend fun getMyStatus(baseUrl: String, accessToken: String): UserStatusData? = withContext(Dispatchers.IO) {
    val req = Request.Builder()
      .url("$baseUrl/api/user-states/me")
      .addHeader("Authorization", "Bearer $accessToken")
      .get()
      .build()

    client.newCall(req).execute().use { res ->
      val body = res.body?.string().orEmpty()
      val type = Types.newParameterizedType(ApiEnvelope::class.java, UserStatusData::class.java)
      val envelope = moshi.adapter<ApiEnvelope<UserStatusData>>(type).fromJson(body)
      if (!res.isSuccessful || envelope?.success != true) {
        throwUnauthorizedIfNeeded(res.code, envelope?.error)
        throw IllegalStateException(envelope?.error ?: "Load status failed (${res.code})")
      }
      envelope.data
    }
  }

  suspend fun setMyStatus(baseUrl: String, accessToken: String, state: String): UserStatusData = withContext(Dispatchers.IO) {
    val payload = moshi.adapter(UserStatusPayload::class.java).toJson(UserStatusPayload(state = state))
    val req = Request.Builder()
      .url("$baseUrl/api/user-states/me")
      .addHeader("Authorization", "Bearer $accessToken")
      .post(payload.toRequestBody(jsonType))
      .build()

    client.newCall(req).execute().use { res ->
      val body = res.body?.string().orEmpty()
      val type = Types.newParameterizedType(ApiEnvelope::class.java, UserStatusData::class.java)
      val envelope = moshi.adapter<ApiEnvelope<UserStatusData>>(type).fromJson(body)
      if (!res.isSuccessful || envelope?.success != true || envelope.data == null) {
        throwUnauthorizedIfNeeded(res.code, envelope?.error)
        throw IllegalStateException(envelope?.error ?: "Save status failed (${res.code})")
      }
      envelope.data
    }
  }

  suspend fun sendFileMessage(
    baseUrl: String,
    accessToken: String,
    file: File,
    mimeType: String,
    type: String,
    targetUserId: String? = null,
    targetGroupId: String? = null,
  ) = withContext(Dispatchers.IO) {
    val uploadPath = if (mimeType.startsWith("audio/")) "audio" else "attachment"
    val body = MultipartBody.Builder()
      .setType(MultipartBody.FORM)
      .addFormDataPart("type", type)
      .addFormDataPart("body", "")
      .apply {
        if (targetUserId != null) addFormDataPart("targetUserId", targetUserId)
        if (targetGroupId != null) addFormDataPart("targetGroupId", targetGroupId)
        addFormDataPart("file", file.name, file.asRequestBody(mimeType.toMediaType()))
      }
      .build()

    val req = Request.Builder()
      .url("$baseUrl/api/messages/$uploadPath")
      .addHeader("Authorization", "Bearer $accessToken")
      .post(body)
      .build()

    client.newCall(req).execute().use { res ->
      val responseBody = res.body?.string().orEmpty()
      if (!res.isSuccessful) {
        val error = runCatching {
          moshi.adapter(SimpleResponse::class.java).fromJson(responseBody)?.error
        }.getOrNull()
        throwUnauthorizedIfNeeded(res.code, error)
        throw IllegalStateException(error ?: "Upload failed (${res.code})")
      }
    }
  }
}
