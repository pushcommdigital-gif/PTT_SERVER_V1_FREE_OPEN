package com.pushcomm.ptt.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.IconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pushcomm.ptt.ui.theme.ColorAccent
import com.pushcomm.ptt.ui.theme.ColorBackground
import com.pushcomm.ptt.ui.theme.ColorSurface
import com.pushcomm.ptt.ui.theme.ColorSurfaceHigh
import com.pushcomm.ptt.ui.theme.ColorTextSecondary
import com.pushcomm.ptt.viewmodel.AppViewModel
import com.pushcomm.ptt.viewmodel.ChatTarget
import com.pushcomm.ptt.viewmodel.MessagesViewModel

private fun mediaSubtitle(raw: String): String {
    val lower = raw.lowercase()
    return when {
        lower.endsWith(".jpg") || lower.endsWith(".jpeg") ||
        lower.endsWith(".png") || lower.endsWith(".gif") ||
        lower.endsWith(".webp") || lower.endsWith(".heic") -> "📷 Image"
        lower.endsWith(".mp4") || lower.endsWith(".mov") ||
        lower.endsWith(".avi") || lower.endsWith(".mkv")  -> "🎥 Video"
        lower.endsWith(".pdf") || lower.endsWith(".doc")  ||
        lower.endsWith(".docx") || lower.endsWith(".xls") ||
        lower.endsWith(".xlsx")                           -> "📄 Document"
        lower.startsWith("http://") || lower.startsWith("https://") -> when {
            lower.contains(".jpg") || lower.contains(".jpeg") ||
            lower.contains(".png") || lower.contains(".gif")  ||
            lower.contains(".webp")                          -> "📷 Image"
            lower.contains(".mp4") || lower.contains(".mov") -> "🎥 Video"
            lower.contains(".pdf")                           -> "📄 Document"
            else                                             -> "📎 Attachment"
        }
        else -> raw
    }
}

@Composable
fun MessagesListScreen(
    appVm: AppViewModel,
    messagesVm: MessagesViewModel,
    onOpenChat: (ChatTarget) -> Unit,
    onCall: ((targetUserId: String, targetName: String) -> Unit)? = null,
) {
    val session by appVm.session.collectAsState()
    val state by messagesVm.state.collectAsState()

    var search by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf("Users") }
    val filters = listOf("Users", "Groups")

    LaunchedEffect(session.loggedIn) {
        if (session.loggedIn) messagesVm.loadConversations(session.baseUrl, session.accessToken)
    }

    // Auto-refresh list whenever a new message arrives (driven by AppViewModel)
    LaunchedEffect(Unit) {
        appVm.messageRefreshTrigger.collect {
            if (session.loggedIn) messagesVm.loadConversations(session.baseUrl, session.accessToken)
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().background(ColorBackground),
    ) {
        // Search bar
        OutlinedTextField(
            value = search,
            onValueChange = { search = it },
            placeholder = { Text("Search conversations", color = ColorTextSecondary) },
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, tint = ColorTextSecondary) },
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            shape = RoundedCornerShape(24.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = ColorAccent,
                unfocusedBorderColor = ColorSurfaceHigh,
                focusedTextColor = Color.White,
                unfocusedTextColor = Color.White,
                cursorColor = ColorAccent,
                focusedContainerColor = ColorSurface,
                unfocusedContainerColor = ColorSurface,
            ),
            singleLine = true,
        )

        // Filter chips
        LazyRow(
            modifier = Modifier.padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(filters) { f ->
                FilterChip(
                    selected = filter == f,
                    onClick = { filter = f },
                    label = { Text(f) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = ColorAccent,
                        selectedLabelColor = Color.White,
                        containerColor = ColorSurface,
                        labelColor = ColorTextSecondary,
                    ),
                )
            }
        }

        Spacer(Modifier.height(8.dp))

        // Build target list — newest message first (ISO-8601 strings sort lexicographically),
        // then alphabetical. Contacts with no messages get "" which sorts last.
        val targets: List<ChatTarget> = if (filter == "Users") {
            session.users
                .filter { u -> u.id != session.userId }
                .map { u ->
                    val convo = state.conversations.direct.firstOrNull { it.partner_id == u.id }
                    val name = "${u.firstName} ${u.lastName}".trim()
                    Pair(convo?.last_message_at ?: "", ChatTarget(
                        type = "direct", targetUserId = u.id, title = name,
                        subtitle = mediaSubtitle(convo?.last_message ?: "Start conversation"),
                        unreadCount = convo?.unread_count ?: 0,
                    ))
                }
                .sortedWith(compareByDescending<Pair<String, ChatTarget>> { it.first }.thenBy { it.second.title })
                .map { it.second }
                .filter { t -> search.isBlank() || t.title.contains(search, ignoreCase = true) }
        } else {
            session.groups
                .map { g ->
                    val convo = state.conversations.group.firstOrNull { it.group_id == g.id }
                    Pair(convo?.last_message_at ?: "", ChatTarget(
                        type = "group", targetGroupId = g.id, title = g.name,
                        subtitle = mediaSubtitle(convo?.last_message ?: "No messages yet"),
                        unreadCount = convo?.unread_count ?: 0,
                    ))
                }
                .sortedWith(compareByDescending<Pair<String, ChatTarget>> { it.first }.thenBy { it.second.title })
                .map { it.second }
                .filter { t -> search.isBlank() || t.title.contains(search, ignoreCase = true) }
        }

        LazyColumn {
            items(targets) { target ->
                ConversationRow(
                    target = target,
                    onClick = { onOpenChat(target) },
                    onCall = if (onCall != null && target.type == "direct" && !target.targetUserId.isNullOrBlank()) {
                        { onCall(target.targetUserId, target.title) }
                    } else null,
                )
                HorizontalDivider(color = ColorSurfaceHigh, thickness = 0.5.dp)
            }
            if (targets.isEmpty()) {
                item {
                    Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) {
                        Text("No conversations", color = ColorTextSecondary)
                    }
                }
            }
        }
    }
}

@Composable
private fun ConversationRow(target: ChatTarget, onClick: () -> Unit, onCall: (() -> Unit)? = null) {
    val initial = target.title.firstOrNull()?.uppercaseChar() ?: '?'
    val avatarColor = when (target.type) {
        "group"     -> ColorAccent
        "broadcast" -> Color(0xFF9B59B6)
        else        -> Color(0xFF2980B9)
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Avatar
        Box(
            modifier = Modifier
                .size(46.dp)
                .clip(CircleShape)
                .background(avatarColor),
            contentAlignment = Alignment.Center,
        ) {
            Text(initial.toString(), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        }

        Spacer(Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(target.title, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Spacer(Modifier.height(2.dp))
            Text(
                target.subtitle,
                color = ColorTextSecondary,
                fontSize = 13.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        if (onCall != null) {
            IconButton(onClick = onCall, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Default.Phone, contentDescription = "Private call", tint = ColorAccent, modifier = Modifier.size(18.dp))
            }
        }

        if (target.unreadCount > 0) {
            Spacer(Modifier.width(8.dp))
            Box(
                modifier = Modifier
                    .size(22.dp)
                    .clip(CircleShape)
                    .background(Color(0xFFE74C3C)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    if (target.unreadCount > 99) "99+" else target.unreadCount.toString(),
                    color = Color.White,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}
