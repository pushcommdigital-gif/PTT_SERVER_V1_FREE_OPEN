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
import { useState } from 'react';
import { useCustomStates, type CustomStateData } from '../hooks/useCustomStates';
import { CustomStateFormModal } from '../components/custom-states/CustomStateFormModal';
import { ConfirmDialog } from '../components/ui';
import { Button } from '../components/ui/Button';
import { apiFetch } from '../lib/api';
import { Plus, Edit2, Trash2, GripVertical } from 'lucide-react';

const TABS = [
  { key: 'personnel', label: 'Personnel Statuses' },
  { key: 'unit', label: 'Unit States' },
  { key: 'staffing', label: 'Staffing Levels' },
] as const;

export function CustomStatesPage() {
  const [activeTab, setActiveTab] = useState<string>('personnel');
  const { states, loading, refetch } = useCustomStates(activeTab);

  const [formOpen, setFormOpen] = useState(false);
  const [editState, setEditState] = useState<CustomStateData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomStateData | null>(null);

  function handleEdit(state: CustomStateData) {
    setEditState(state);
    setFormOpen(true);
  }

  function handleCreate() {
    setEditState(null);
    setFormOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await apiFetch(`/custom-states/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null);
    refetch();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Status Settings</h1>
          <p className="text-text-secondary mt-1">
            Define company-specific status labels, colors, and button text used by dispatch and field users.
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus size={16} className="mr-1.5" />
          Add State
        </Button>
      </div>

      {/* Tabs */}
      <div className="rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm text-info">
        Personnel statuses are company-specific. A delivery team may use labels like "Loading" or
        "Delivered"; a security team may use "Patrol", "On Scene", or "Report Writing".
      </div>

      <div className="flex gap-1 bg-bg-card rounded-lg p-1 border border-border w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-accent text-white'
                : 'text-text-secondary hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* State list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : states.length === 0 ? (
        <div className="bg-bg-card border border-border rounded-lg p-12 text-center">
          <p className="text-text-secondary">No custom states defined for this type.</p>
          <p className="text-text-secondary text-sm mt-1">Click "Add State" to create one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {states.map((state) => (
            <div
              key={state.id}
              className="flex items-center gap-4 bg-bg-card border border-border rounded-lg px-4 py-3"
            >
              <GripVertical size={16} className="text-text-secondary" />

              {/* Color preview */}
              <div
                className="w-4 h-4 rounded-full flex-shrink-0"
                style={{ backgroundColor: state.buttonColor }}
              />

              {/* Button preview */}
              <span
                className="px-3 py-1 rounded-md text-white text-xs font-medium flex-shrink-0"
                style={{ backgroundColor: state.buttonColor }}
              >
                {state.buttonText}
              </span>

              {/* Name */}
              <span className="flex-1 font-medium">{state.name}</span>

              {/* Order */}
              <span className="text-text-secondary text-sm">#{state.displayOrder}</span>

              {/* Actions */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleEdit(state)}
                  className="p-1.5 text-text-secondary hover:text-white rounded transition-colors"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={() => setDeleteTarget(state)}
                  className="p-1.5 text-text-secondary hover:text-danger rounded transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CustomStateFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSuccess={refetch}
        editState={editState}
        defaultType={activeTab}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Custom State"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
      />
    </div>
  );
}
