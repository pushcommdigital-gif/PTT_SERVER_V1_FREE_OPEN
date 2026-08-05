package com.pushcomm.ptt.viewmodel

import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.pushcomm.ptt.PttForegroundService
import com.pushcomm.ptt.VoiceSessionManager
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class PttViewModel(application: Application) : AndroidViewModel(application) {
    private var boundService: PttForegroundService? = null
    private var collectJob: Job? = null

    private val _voiceState = MutableStateFlow(VoiceSessionManager.VoiceState())
    val voiceState: StateFlow<VoiceSessionManager.VoiceState> = _voiceState.asStateFlow()

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val service = (binder as? PttForegroundService.LocalBinder)?.getService() ?: return
            boundService = service
            collectJob?.cancel()
            collectJob = viewModelScope.launch {
                service.voiceState.collect { _voiceState.value = it }
            }
        }
        override fun onServiceDisconnected(name: ComponentName?) {
            boundService = null
            collectJob?.cancel()
        }
    }

    fun bindService() {
        getApplication<Application>().bindService(
            Intent(getApplication(), PttForegroundService::class.java),
            serviceConnection,
            Context.BIND_AUTO_CREATE,
        )
    }

    fun unbindService() {
        collectJob?.cancel()
        runCatching {
            getApplication<Application>().unbindService(serviceConnection)
        }
        boundService = null
    }

    fun connectGroup(
        baseUrl: String,
        accessToken: String,
        groupId: String,
        groupName: String,
        userId: String,
        userName: String,
    ) {
        val intent = PttForegroundService.startIntent(
            context = getApplication(),
            baseUrl = baseUrl,
            accessToken = accessToken,
            groupId = groupId,
            groupName = groupName,
            userId = userId,
            userName = userName,
        )
        ContextCompat.startForegroundService(getApplication(), intent)
    }

    fun startTalking() {
        boundService?.startTalking()
    }

    fun stopTalking() {
        boundService?.stopTalking()
    }

    fun muteGroupAudio(mute: Boolean) {
        boundService?.muteRemoteAudio(mute)
    }

    fun disconnectAndStop() {
        boundService?.disconnect()
        _voiceState.value = VoiceSessionManager.VoiceState()
        getApplication<Application>().stopService(
            Intent(getApplication(), PttForegroundService::class.java),
        )
    }

    /** Propagate a refreshed JWT access token to the running foreground service. */
    fun updateToken(newToken: String) {
        boundService?.updateToken(newToken)
    }

    /** Start GPS posting from the foreground service (call after location permission is granted). */
    fun startGps() {
        boundService?.startGps()
    }

    override fun onCleared() {
        super.onCleared()
        unbindService()
    }
}
