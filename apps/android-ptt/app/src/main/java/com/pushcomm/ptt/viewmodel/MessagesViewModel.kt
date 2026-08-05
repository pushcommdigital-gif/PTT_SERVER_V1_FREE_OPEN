package com.pushcomm.ptt.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.pushcomm.ptt.ConversationsData
import com.pushcomm.ptt.MessageData
import com.pushcomm.ptt.PushcommApi
import com.pushcomm.ptt.PushcommUnauthorizedException
import com.pushcomm.ptt.SessionPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File
import java.time.Instant

data class ChatTarget(
    val type: String,          // "direct" | "group" | "broadcast"
    val targetUserId: String? = null,
    val targetGroupId: String? = null,
    val title: String,
    val subtitle: String,
    val unreadCount: Int = 0,
)

data class MessagesState(
    val conversations: ConversationsData = ConversationsData(emptyList(), emptyList(), emptyList()),
    val thread: List<MessageData> = emptyList(),
    val activeTarget: ChatTarget? = null,
    val sending: Boolean = false,
    val loading: Boolean = false,
    val error: String? = null,
)

class MessagesViewModel(application: Application) : AndroidViewModel(application) {
    private val api = PushcommApi()
    private val prefs = SessionPreferences(application)

    private val _state = MutableStateFlow(MessagesState())
    val state: StateFlow<MessagesState> = _state.asStateFlow()

    private suspend fun refreshMessageToken(baseUrl: String): String? {
        val refreshToken = prefs.refreshToken
        if (baseUrl.isBlank() || refreshToken.isBlank()) return null
        return runCatching {
            val data = api.refreshTokens(baseUrl, refreshToken)
            prefs.accessToken = data.accessToken
            prefs.refreshToken = data.refreshToken
            data.accessToken
        }.getOrNull()
    }

    private suspend fun <T> withAuthRetry(
        baseUrl: String,
        token: String,
        block: suspend (String) -> T,
    ): T {
        val firstToken = prefs.accessToken.ifBlank { token }
        return try {
            block(firstToken)
        } catch (e: PushcommUnauthorizedException) {
            val refreshed = refreshMessageToken(baseUrl) ?: throw e
            block(refreshed)
        }
    }

    fun loadConversations(baseUrl: String, token: String) {
        viewModelScope.launch {
            try {
                _state.value = _state.value.copy(loading = true)
                val conv = withAuthRetry(baseUrl, token) { freshToken ->
                    api.listConversations(baseUrl, freshToken)
                }
                _state.value = _state.value.copy(conversations = conv, loading = false)
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = e.message)
            }
        }
    }

    fun openChat(baseUrl: String, token: String, target: ChatTarget) {
        _state.value = _state.value.copy(activeTarget = target, thread = emptyList())
        loadThread(baseUrl, token, target)
        // Mark all unread messages in this conversation as read (fire and forget)
        viewModelScope.launch {
            try {
                withAuthRetry(baseUrl, token) { freshToken ->
                    api.markConversationRead(
                        baseUrl = baseUrl,
                        accessToken = freshToken,
                        type = target.type,
                        targetUserId = target.targetUserId,
                        targetGroupId = target.targetGroupId,
                    )
                }
            } catch (_: Exception) { }
        }
    }

    fun loadThread(baseUrl: String, token: String, target: ChatTarget? = null) {
        val resolvedTarget = target ?: _state.value.activeTarget ?: return
        viewModelScope.launch {
            try {
                val messages = withAuthRetry(baseUrl, token) { freshToken ->
                    api.listMessages(
                        baseUrl = baseUrl,
                        accessToken = freshToken,
                        type = resolvedTarget.type,
                        targetUserId = resolvedTarget.targetUserId,
                        targetGroupId = resolvedTarget.targetGroupId,
                    )
                }
                _state.value = _state.value.copy(thread = messages.reversed())
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.message)
            }
        }
    }

    fun sendText(baseUrl: String, token: String, text: String, userId: String) {
        val target = _state.value.activeTarget ?: return
        if (text.isBlank()) return
        viewModelScope.launch {
            try {
                _state.value = _state.value.copy(sending = true)
                withAuthRetry(baseUrl, token) { freshToken ->
                    api.sendMessage(
                        baseUrl = baseUrl,
                        accessToken = freshToken,
                        type = target.type,
                        bodyText = text,
                        targetUserId = target.targetUserId,
                        targetGroupId = target.targetGroupId,
                    )
                }
                // Optimistic: add message to thread immediately so user sees it right away
                val optimistic = MessageData(
                    id = "pending-${System.currentTimeMillis()}",
                    senderId = userId,
                    type = target.type,
                    targetUserId = target.targetUserId,
                    targetGroupId = target.targetGroupId,
                    body = text.trim(),
                    createdAt = Instant.now().toString(),
                    senderFirstName = null,
                    senderLastName = null,
                )
                _state.value = _state.value.copy(thread = _state.value.thread + optimistic)
                // Refresh from server for accuracy (uses API fix for group visibility)
                val messages = withAuthRetry(baseUrl, token) { freshToken ->
                    api.listMessages(
                        baseUrl = baseUrl,
                        accessToken = freshToken,
                        type = target.type,
                        targetUserId = target.targetUserId,
                        targetGroupId = target.targetGroupId,
                    )
                }
                // Only overwrite if server returns data — if empty, keep optimistic message
                if (messages.isNotEmpty()) {
                    _state.value = _state.value.copy(thread = messages.reversed())
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.message)
            } finally {
                _state.value = _state.value.copy(sending = false)
            }
        }
    }

    fun sendFile(baseUrl: String, token: String, file: File, mimeType: String) {
        val target = _state.value.activeTarget ?: return
        viewModelScope.launch {
            try {
                _state.value = _state.value.copy(sending = true)
                withAuthRetry(baseUrl, token) { freshToken ->
                    api.sendFileMessage(
                        baseUrl = baseUrl,
                        accessToken = freshToken,
                        file = file,
                        mimeType = mimeType,
                        type = target.type,
                        targetUserId = target.targetUserId,
                        targetGroupId = target.targetGroupId,
                    )
                }
                val messages = withAuthRetry(baseUrl, token) { freshToken ->
                    api.listMessages(
                        baseUrl = baseUrl,
                        accessToken = freshToken,
                        type = target.type,
                        targetUserId = target.targetUserId,
                        targetGroupId = target.targetGroupId,
                    )
                }
                _state.value = _state.value.copy(thread = messages.reversed())
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.message)
            } finally {
                _state.value = _state.value.copy(sending = false)
            }
        }
    }

    fun clearError() { _state.value = _state.value.copy(error = null) }

    fun clearActiveTarget() { _state.value = _state.value.copy(activeTarget = null, thread = emptyList()) }
}
