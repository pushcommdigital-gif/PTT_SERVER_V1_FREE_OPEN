/*
 * PushComm Community Edition
 * Copyright (C) 2026 PushComm Digital
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See the LICENSE file for the full text.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// Core schema. Add-on tables (transcripts, trips/telematics, incidents/media,
// app releases) live in the private add-on package and are re-exported from
// there — the core never references them.
export { departments } from './departments.js';
export { appConfig } from './app-config.js';
export { users } from './users.js';
export { userStates } from './user-states.js';
export { groups } from './groups.js';
export { groupMembers } from './group-members.js';
export { units } from './units.js';
export { unitStates } from './unit-states.js';
export { calls } from './calls.js';
export { callDispatches } from './call-dispatches.js';
export { callNotes } from './call-notes.js';
export { callAttachments } from './call-attachments.js';
export { locations } from './locations.js';
export { audioLibrary } from './audio-library.js';
export { messages } from './messages.js';
export { customStates } from './custom-states.js';
export { actionLogs } from './action-logs.js';
export { permissions } from './permissions.js';
export { roles } from './roles.js';
export { groupTypes } from './group-types.js';
export { devices } from './devices.js';
export { voiceChannels } from './voice-channels.js';
export { voiceChannelGroups } from './voice-channel-groups.js';
export { voiceChannelUsers } from './voice-channel-users.js';
export { voiceRecordings } from './voice-recordings.js';
export { customers } from './customers.js';
export { customerLocations } from './customer-locations.js';
export { jobs } from './jobs.js';
export { sosEvents } from './sos.js';
export { pttSessions } from './ptt-sessions.js';
export { geofences } from './geofences.js';
export { pointsOfInterest } from './points-of-interest.js';
export { zoneAlerts } from './zone-alerts.js';
