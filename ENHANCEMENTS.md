# Enhancement Roadmap: Matching Paid Alternatives

This document outlines technical enhancements needed to achieve feature parity with commercial SOW/proposal tools like PandaDoc ($228-588/year), Dropbox Sign ($180-300/year), and other enterprise platforms[web:25][web:27][web:56][web:57][web:58].

## Priority 1: Real-Time Collaboration (PandaDoc's Core Feature)

### Current State
- Single-user local editing with IndexedDB
- No multi-user simultaneous editing
- Manual document sharing via export/import

### Enhancement: WebSocket-Based Real-Time Collaboration

**What PandaDoc Has:**[web:56][web:57][web:58][web:60]
- Multiple team members editing simultaneously
- Live cursor tracking showing who's editing where
- Real-time comment threads on specific sections
- In-document @mentions for team notifications
- Live activity feed showing edits, approvals, comments

**Implementation Plan:**

```python
# New file: app/collaboration.py
from flask_socketio import SocketIO, emit, join_room, leave_room
import json
from datetime import datetime

socketio = SocketIO(cors_allowed_origins="*")

# Active document sessions
active_sessions = {}  # {doc_id: {user_id: {cursor_pos, last_seen, name}}}

@socketio.on('join_document')
def handle_join(data):
    doc_id = data['doc_id']
    user_id = data['user_id']
    user_name = data['user_name']
    
    join_room(doc_id)
    
    if doc_id not in active_sessions:
        active_sessions[doc_id] = {}
    
    active_sessions[doc_id][user_id] = {
        'name': user_name,
        'cursor_pos': 0,
        'color': generate_user_color(user_id),
        'last_seen': datetime.utcnow().isoformat()
    }
    
    # Broadcast to all users in this document
    emit('user_joined', {
        'user_id': user_id,
        'user_name': user_name,
        'active_users': active_sessions[doc_id]
    }, room=doc_id)

@socketio.on('edit_content')
def handle_edit(data):
    doc_id = data['doc_id']
    user_id = data['user_id']
    operation = data['operation']  # {type: 'insert'|'delete', pos: int, content: str}
    
    # Operational Transformation (OT) for conflict resolution
    transformed_op = apply_operational_transformation(operation, doc_id)
    
    emit('content_changed', {
        'user_id': user_id,
        'operation': transformed_op,
        'timestamp': datetime.utcnow().isoformat()
    }, room=doc_id, include_self=False)

@socketio.on('cursor_move')
def handle_cursor(data):
    doc_id = data['doc_id']
    user_id = data['user_id']
    cursor_pos = data['cursor_pos']
    selection = data.get('selection', None)
    
    if doc_id in active_sessions and user_id in active_sessions[doc_id]:
        active_sessions[doc_id][user_id]['cursor_pos'] = cursor_pos
        active_sessions[doc_id][user_id]['selection'] = selection
    
    emit('cursor_update', {
        'user_id': user_id,
        'cursor_pos': cursor_pos,
        'selection': selection,
        'user_name': active_sessions[doc_id][user_id]['name'],
        'color': active_sessions[doc_id][user_id]['color']
    }, room=doc_id, include_self=False)

@socketio.on('add_comment')
def handle_comment(data):
    doc_id = data['doc_id']
    user_id = data['user_id']
    comment = {
        'id': generate_comment_id(),
        'user_id': user_id,
        'user_name': data['user_name'],
        'text': data['text'],
        'start_pos': data['start_pos'],
        'end_pos': data['end_pos'],
        'timestamp': datetime.utcnow().isoformat(),
        'resolved': False,
        'replies': []
    }
    
    # Save to database
    save_comment(doc_id, comment)
    
    emit('comment_added', comment, room=doc_id)

def apply_operational_transformation(operation, doc_id):
    """
    Implement OT algorithm for conflict-free concurrent editing
    Based on Google Docs' approach
    """
    # Simplified OT - full implementation requires OT libraries
    # like ShareDB or Yjs
    return operation

def generate_user_color(user_id):
    """Generate consistent color for user cursors/selections"""
    colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']
    return colors[hash(user_id) % len(colors)]
```

**Frontend Implementation:**

```javascript
// static/js/collaboration.js
class CollaborationManager {
    constructor(docId, userId, userName) {
        this.docId = docId;
        this.userId = userId;
        this.userName = userName;
        this.socket = io();
        this.activeUsers = {};
        this.pendingOperations = [];
        
        this.initializeSocket();
    }
    
    initializeSocket() {
        this.socket.emit('join_document', {
            doc_id: this.docId,
            user_id: this.userId,
            user_name: this.userName
        });
        
        this.socket.on('user_joined', (data) => {
            this.activeUsers = data.active_users;
            this.updateActiveUsersList();
        });
        
        this.socket.on('content_changed', (data) => {
            this.applyRemoteOperation(data.operation, data.user_id);
        });
        
        this.socket.on('cursor_update', (data) => {
            this.renderRemoteCursor(data);
        });
        
        this.socket.on('comment_added', (comment) => {
            this.renderComment(comment);
        });
    }
    
    handleLocalEdit(operation) {
        // Send to server
        this.socket.emit('edit_content', {
            doc_id: this.docId,
            user_id: this.userId,
            operation: operation
        });
    }
    
    handleCursorMove(position, selection) {
        this.socket.emit('cursor_move', {
            doc_id: this.docId,
            user_id: this.userId,
            cursor_pos: position,
            selection: selection
        });
    }
    
    addComment(text, startPos, endPos) {
        this.socket.emit('add_comment', {
            doc_id: this.docId,
            user_id: this.userId,
            user_name: this.userName,
            text: text,
            start_pos: startPos,
            end_pos: endPos
        });
    }
    
    renderRemoteCursor(data) {
        // Create floating cursor indicator
        const cursorEl = document.getElementById(`cursor-${data.user_id}`) || 
            this.createCursorElement(data);
        
        // Position at cursor location
        const editorRect = document.getElementById('markdown-editor').getBoundingClientRect();
        const textMetrics = this.calculateTextPosition(data.cursor_pos);
        
        cursorEl.style.left = textMetrics.x + 'px';
        cursorEl.style.top = textMetrics.y + 'px';
        
        // Show selection if exists
        if (data.selection) {
            this.renderRemoteSelection(data.user_id, data.selection, data.color);
        }
    }
    
    createCursorElement(data) {
        const cursor = document.createElement('div');
        cursor.id = `cursor-${data.user_id}`;
        cursor.className = 'remote-cursor';
        cursor.style.borderLeftColor = data.color;
        
        const label = document.createElement('span');
        label.className = 'remote-cursor-label';
        label.style.backgroundColor = data.color;
        label.textContent = data.user_name;
        
        cursor.appendChild(label);
        document.getElementById('editor-container').appendChild(cursor);
        return cursor;
    }
    
    renderComment(comment) {
        // Add comment indicator to text
        const marker = document.createElement('span');
        marker.className = 'comment-marker';
        marker.dataset.commentId = comment.id;
        marker.title = `${comment.user_name}: ${comment.text}`;
        marker.addEventListener('click', () => this.openCommentThread(comment.id));
        
        // Insert at appropriate position in editor
        this.insertCommentMarker(marker, comment.start_pos);
    }
}

// CSS for collaboration features
const COLLABORATION_CSS = `
.remote-cursor {
    position: absolute;
    width: 2px;
    height: 20px;
    border-left: 2px solid;
    pointer-events: none;
    z-index: 100;
    transition: left 0.1s, top 0.1s;
}

.remote-cursor-label {
    position: absolute;
    top: -20px;
    left: -4px;
    font-size: 11px;
    color: white;
    padding: 2px 6px;
    border-radius: 3px;
    white-space: nowrap;
    pointer-events: none;
}

.remote-selection {
    background-color: rgba(59, 130, 246, 0.2);
    position: absolute;
    pointer-events: none;
}

.comment-marker {
    background-color: #fef3c7;
    border-bottom: 2px solid #f59e0b;
    cursor: pointer;
}

.comment-thread {
    position: absolute;
    right: 20px;
    width: 300px;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 12px;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    z-index: 200;
}

.active-users-list {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px 12px;
    background: #f9fafb;
    border-radius: 6px;
}

.user-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 600;
    font-size: 14px;
}
`;
```

**Estimated Implementation Time:** 2-3 weeks
**Dependencies:** `flask-socketio`, `python-socketio`, `redis` (for production scaling)

---

## Priority 2: AI-Powered Content Assistance

### Current State
- Manual markdown writing
- Static templates with variable substitution
- No intelligent content suggestions

### Enhancement: AI Writing Assistant

**What Commercial Tools Have:**[web:61][web:64][web:67]
- AI-generated content based on prompts
- Smart clause suggestions based on jurisdiction
- Tone and compliance checking
- Auto-completion of common sections
- Content improvement recommendations

**Implementation Plan:**

```python
# app/ai_assistant.py
import anthropic  # or openai
from typing import Dict, List, Optional

class SOWAIAssistant:
    def __init__(self, api_key: str, model: str = "claude-3-5-sonnet-20241022"):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model
    
    def generate_section(self, section_type: str, context: Dict) -> str:
        """
        Generate SOW section based on type and context
        
        Args:
            section_type: 'scope', 'deliverables', 'timeline', 'pricing', etc.
            context: Project details, client info, requirements
        """
        prompts = {
            'scope': self._scope_prompt,
            'deliverables': self._deliverables_prompt,
            'timeline': self._timeline_prompt,
            'payment_terms': self._payment_terms_prompt,
            'acceptance_criteria': self._acceptance_criteria_prompt
        }
        
        prompt = prompts.get(section_type, self._generic_prompt)(context)
        
        response = self.client.messages.create(
            model=self.model,
            max_tokens=1500,
            messages=[{
                "role": "user",
                "content": prompt
            }]
        )
        
        return response.content[0].text
    
    def _scope_prompt(self, context: Dict) -> str:
        return f"""
You are an expert consultant creating a Statement of Work.

Project Type: {context.get('project_type', 'software development')}
Client: {context.get('client_name', 'TBD')}
Budget Range: {context.get('budget', 'TBD')}
Timeline: {context.get('timeline', 'TBD')}
Key Requirements: {context.get('requirements', 'TBD')}

Generate a professional "Scope" section for this SOW that includes:
1. In-Scope items (what WILL be delivered)
2. Out-of-Scope items (what will NOT be included)
3. Assumptions and dependencies

Format the response in markdown with clear sections. Be specific and avoid vague language.
Do not use placeholder text - make it realistic for this type of project.
"""
    
    def _deliverables_prompt(self, context: Dict) -> str:
        return f"""
Generate a "Deliverables" section for a {context.get('project_type')} SOW.

Scope: {context.get('scope_summary', 'TBD')}
Timeline: {context.get('timeline', 'TBD')}

List specific, measurable deliverables with:
- Clear description of each deliverable
- Format/type (document, code, design, etc.)
- Delivery date or phase

Format in markdown. Make deliverables concrete and verifiable.
"""
    
    def suggest_clause(self, jurisdiction: str, clause_type: str) -> str:
        """
        Suggest legal clause based on jurisdiction and type
        """
        return self.client.messages.create(
            model=self.model,
            max_tokens=800,
            messages=[{
                "role": "user",
                "content": f"""
Generate a professional {clause_type} clause for a consulting SOW in {jurisdiction}.

Clause Type: {clause_type}
Jurisdiction: {jurisdiction}

Provide standard protective language appropriate for independent consultants.
Format in markdown. Make it clear and enforceable.

DO NOT provide legal advice - this is a template suggestion only.
"""
            }]
        ).content[0].text
    
    def improve_text(self, text: str, improvement_type: str) -> Dict:
        """
        Improve existing text for clarity, professionalism, or compliance
        
        improvement_type: 'clarity', 'professional_tone', 'compliance_check'
        """
        prompts = {
            'clarity': "Rewrite this SOW text to be clearer and more specific. Remove vague language.",
            'professional_tone': "Rewrite this to sound more professional and business-appropriate.",
            'compliance_check': "Review this SOW text for potential legal or compliance issues. Suggest improvements."
        }
        
        response = self.client.messages.create(
            model=self.model,
            max_tokens=1200,
            messages=[{
                "role": "user",
                "content": f"{prompts[improvement_type]}\n\nOriginal Text:\n{text}"
            }]
        )
        
        return {
            'original': text,
            'improved': response.content[0].text,
            'improvement_type': improvement_type
        }
    
    def generate_pricing_table(self, context: Dict) -> str:
        """
        Generate pricing table based on project details
        """
        return self.client.messages.create(
            model=self.model,
            max_tokens=1000,
            messages=[{
                "role": "user",
                "content": f"""
Create a detailed pricing table for this project:

Project Type: {context.get('project_type')}
Scope Summary: {context.get('scope_summary')}
Estimated Hours: {context.get('estimated_hours', 'TBD')}
Hourly Rate: {context.get('hourly_rate', '$150')}

Generate a markdown table using the :::pricing directive:

:::pricing
| Phase | Description | Hours | Rate | Total |
|---|---|---:|---:|---:|
[generate rows based on typical phases for this project type]
:::

Break down into logical phases (Discovery, Development, Testing, etc.).
Be realistic with hour estimates.
"""
            }]
        ).content[0].text

# Flask route for AI assistance
@app.route('/api/ai/generate', methods=['POST'])
def generate_ai_content():
    data = request.json
    section_type = data.get('section_type')
    context = data.get('context', {})
    
    api_key = os.getenv('ANTHROPIC_API_KEY') or os.getenv('OPENAI_API_KEY')
    if not api_key:
        return jsonify({'error': 'AI features require API key configuration'}), 400
    
    assistant = SOWAIAssistant(api_key)
    
    try:
        content = assistant.generate_section(section_type, context)
        return jsonify({
            'content': content,
            'section_type': section_type
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/ai/improve', methods=['POST'])
def improve_text():
    data = request.json
    text = data.get('text')
    improvement_type = data.get('improvement_type', 'clarity')
    
    api_key = os.getenv('ANTHROPIC_API_KEY') or os.getenv('OPENAI_API_KEY')
    if not api_key:
        return jsonify({'error': 'AI features require API key configuration'}), 400
    
    assistant = SOWAIAssistant(api_key)
    
    try:
        result = assistant.improve_text(text, improvement_type)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

**Frontend Integration:**

```javascript
// static/js/ai_assistant.js
class AIAssistant {
    constructor() {
        this.setupUI();
    }
    
    setupUI() {
        // Add AI assistant button to toolbar
        const toolbar = document.getElementById('toolbar');
        const aiBtn = document.createElement('button');
        aiBtn.id = 'btn-ai-assistant';
        aiBtn.innerHTML = '✨ AI Assistant';
        aiBtn.className = 'btn-secondary';
        aiBtn.addEventListener('click', () => this.openAssistant());
        toolbar.appendChild(aiBtn);
    }
    
    async generateSection(sectionType, context) {
        const response = await fetch('/api/ai/generate', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                section_type: sectionType,
                context: context
            })
        });
        
        if (!response.ok) {
            throw new Error('AI generation failed');
        }
        
        const data = await response.json();
        return data.content;
    }
    
    async improveSelection() {
        const editor = document.getElementById('markdown-editor');
        const selectedText = editor.value.substring(
            editor.selectionStart,
            editor.selectionEnd
        );
        
        if (!selectedText) {
            alert('Please select text to improve');
            return;
        }
        
        const improvementType = await this.showImprovementOptions();
        if (!improvementType) return;
        
        const response = await fetch('/api/ai/improve', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                text: selectedText,
                improvement_type: improvementType
            })
        });
        
        const data = await response.json();
        this.showImprovementPreview(data.original, data.improved);
    }
    
    openAssistant() {
        // Show AI assistant modal with options:
        // - Generate scope section
        // - Generate deliverables
        // - Generate timeline
        // - Generate pricing table
        // - Improve selected text
        // - Suggest legal clauses
        
        const modal = document.createElement('div');
        modal.className = 'ai-assistant-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>✨ AI Assistant</h3>
                <div class="ai-options">
                    <button class="ai-option" data-action="generate-scope">
                        📋 Generate Scope Section
                    </button>
                    <button class="ai-option" data-action="generate-deliverables">
                        📦 Generate Deliverables
                    </button>
                    <button class="ai-option" data-action="generate-timeline">
                        📅 Generate Timeline
                    </button>
                    <button class="ai-option" data-action="generate-pricing">
                        💰 Generate Pricing Table
                    </button>
                    <button class="ai-option" data-action="improve-text">
                        ✏️ Improve Selected Text
                    </button>
                    <button class="ai-option" data-action="suggest-clause">
                        ⚖️ Suggest Legal Clause
                    </button>
                </div>
                <button class="btn-close">Close</button>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        modal.querySelectorAll('.ai-option').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                this.handleAIAction(action);
                modal.remove();
            });
        });
        
        modal.querySelector('.btn-close').addEventListener('click', () => {
            modal.remove();
        });
    }
    
    async handleAIAction(action) {
        const context = this.gatherContext();
        
        switch(action) {
            case 'generate-scope':
                const scope = await this.generateSection('scope', context);
                this.insertAtCursor(scope);
                break;
            case 'generate-deliverables':
                const deliverables = await this.generateSection('deliverables', context);
                this.insertAtCursor(deliverables);
                break;
            case 'improve-text':
                await this.improveSelection();
                break;
            // ... other actions
        }
    }
    
    gatherContext() {
        // Collect context from current document
        const variables = {};
        document.querySelectorAll('[data-var]').forEach(input => {
            variables[input.dataset.var] = input.value;
        });
        
        return {
            project_name: variables.project_name || 'Untitled Project',
            client_name: variables.client_name || '',
            consultant_name: variables.consultant_name || '',
            // Add more context as needed
        };
    }
    
    insertAtCursor(text) {
        const editor = document.getElementById('markdown-editor');
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        
        editor.value = editor.value.substring(0, start) + 
                       text + 
                       editor.value.substring(end);
        
        // Trigger change event
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

// Initialize AI assistant
const aiAssistant = new AIAssistant();
```

**Environment Configuration:**

```bash
# .env additions
ANTHROPIC_API_KEY=sk-ant-xxx  # or OPENAI_API_KEY
AI_MODEL=claude-3-5-sonnet-20241022
AI_MAX_TOKENS=1500
AI_ENABLED=true
```

**Estimated Implementation Time:** 1-2 weeks
**Dependencies:** `anthropic` or `openai` Python SDK
**Cost:** ~$0.01-0.05 per AI-generated section (far cheaper than $19-49/month subscriptions)

---

## Priority 3: Advanced Approval Workflows

### Current State
- Binary signature capture (consultant + client)
- No multi-step approval chains
- No conditional routing

### Enhancement: Multi-Stage Approval System

**What Commercial Tools Have:**[web:56][web:58][web:62][web:65]
- Sequential approval chains (Legal → Finance → Executive → Client)
- Parallel approval groups (multiple stakeholders at same time)
- Conditional routing based on document properties
- Automatic reminders for pending approvals
- Delegation and proxy approval
- Approval history and audit trail

**Implementation:**

```python
# app/approvals.py
from enum import Enum
from typing import List, Dict, Optional
from datetime import datetime, timedelta

class ApprovalType(Enum):
    SEQUENTIAL = "sequential"  # One after another
    PARALLEL = "parallel"      # All at once
    CONDITIONAL = "conditional" # Based on rules

class ApprovalStatus(Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    DELEGATED = "delegated"
    SKIPPED = "skipped"

class ApprovalWorkflow:
    def __init__(self, doc_id: str, workflow_config: Dict):
        self.doc_id = doc_id
        self.workflow_type = ApprovalType(workflow_config['type'])
        self.stages = workflow_config['stages']  # List of approval stages
        self.current_stage = 0
        self.created_at = datetime.utcnow()
    
    def get_current_approvers(self) -> List[Dict]:
        """
        Returns list of users who need to approve at current stage
        """
        if self.current_stage >= len(self.stages):
            return []  # Workflow complete
        
        stage = self.stages[self.current_stage]
        return stage['approvers']
    
    def submit_approval(self, user_id: str, decision: ApprovalStatus, 
                       comment: Optional[str] = None) -> Dict:
        """
        Submit an approval decision
        """
        stage = self.stages[self.current_stage]
        
        # Record approval
        approval_record = {
            'user_id': user_id,
            'stage': self.current_stage,
            'decision': decision.value,
            'comment': comment,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        # Add to stage approvals
        if 'approvals' not in stage:
            stage['approvals'] = []
        stage['approvals'].append(approval_record)
        
        # Check if stage is complete
        if self.is_stage_complete():
            if decision == ApprovalStatus.REJECTED:
                return {'status': 'rejected', 'by': user_id, 'stage': self.current_stage}
            
            self.current_stage += 1
            
            if self.current_stage >= len(self.stages):
                return {'status': 'complete', 'approved': True}
            else:
                # Notify next stage approvers
                self.notify_next_approvers()
                return {'status': 'advanced', 'stage': self.current_stage}
        
        return {'status': 'pending', 'stage': self.current_stage}
    
    def is_stage_complete(self) -> bool:
        """
        Check if current stage has all required approvals
        """
        stage = self.stages[self.current_stage]
        approvals = stage.get('approvals', [])
        
        if self.workflow_type == ApprovalType.SEQUENTIAL:
            # Sequential: need first person's approval to proceed
            return len(approvals) > 0 and approvals[-1]['decision'] == 'approved'
        
        elif self.workflow_type == ApprovalType.PARALLEL:
            # Parallel: need ALL approvers to approve
            required_count = len(stage['approvers'])
            approved_count = sum(1 for a in approvals if a['decision'] == 'approved')
            return approved_count == required_count
        
        return False
    
    def notify_next_approvers(self):
        """
        Send email/notification to next stage approvers
        """
        approvers = self.get_current_approvers()
        stage = self.stages[self.current_stage]
        
        for approver in approvers:
            send_approval_notification(
                user_id=approver['user_id'],
                doc_id=self.doc_id,
                stage_name=stage['name'],
                due_date=datetime.utcnow() + timedelta(days=stage.get('due_days', 3))
            )
    
    def delegate_approval(self, from_user: str, to_user: str) -> bool:
        """
        Delegate approval to another user
        """
        stage = self.stages[self.current_stage]
        
        for approver in stage['approvers']:
            if approver['user_id'] == from_user:
                approver['delegated_to'] = to_user
                approver['delegated_at'] = datetime.utcnow().isoformat()
                return True
        
        return False

# Database models
class ApprovalWorkflowModel(db.Model):
    __tablename__ = 'approval_workflows'
    
    id = db.Column(db.String(50), primary_key=True)
    doc_id = db.Column(db.String(50), nullable=False, index=True)
    workflow_config = db.Column(db.JSON, nullable=False)
    current_stage = db.Column(db.Integer, default=0)
    status = db.Column(db.String(20), default='pending')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class ApprovalHistory(db.Model):
    __tablename__ = 'approval_history'
    
    id = db.Column(db.String(50), primary_key=True)
    workflow_id = db.Column(db.String(50), db.ForeignKey('approval_workflows.id'))
    user_id = db.Column(db.String(50), nullable=False)
    stage = db.Column(db.Integer, nullable=False)
    decision = db.Column(db.String(20), nullable=False)
    comment = db.Column(db.Text)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

# Flask routes
@app.route('/api/workflows/<doc_id>', methods=['POST'])
def create_workflow(doc_id):
    """Create approval workflow for document"""
    data = request.json
    
    workflow = ApprovalWorkflowModel(
        id=uid('workflow'),
        doc_id=doc_id,
        workflow_config=data['config']
    )
    
    db.session.add(workflow)
    db.session.commit()
    
    # Notify first stage approvers
    workflow_obj = ApprovalWorkflow(doc_id, data['config'])
    workflow_obj.notify_next_approvers()
    
    return jsonify({'workflow_id': workflow.id, 'status': 'created'})

@app.route('/api/workflows/<workflow_id>/approve', methods=['POST'])
def submit_approval(workflow_id):
    """Submit approval decision"""
    data = request.json
    user_id = data['user_id']
    decision = ApprovalStatus(data['decision'])
    comment = data.get('comment')
    
    workflow = ApprovalWorkflowModel.query.get(workflow_id)
    if not workflow:
        return jsonify({'error': 'Workflow not found'}), 404
    
    workflow_obj = ApprovalWorkflow(workflow.doc_id, workflow.workflow_config)
    workflow_obj.current_stage = workflow.current_stage
    
    result = workflow_obj.submit_approval(user_id, decision, comment)
    
    # Update database
    workflow.current_stage = workflow_obj.current_stage
    workflow.workflow_config = workflow_obj.stages
    workflow.updated_at = datetime.utcnow()
    
    if result['status'] == 'complete':
        workflow.status = 'approved'
    elif result['status'] == 'rejected':
        workflow.status = 'rejected'
    
    # Record in history
    history = ApprovalHistory(
        id=uid('approval'),
        workflow_id=workflow_id,
        user_id=user_id,
        stage=workflow.current_stage,
        decision=decision.value,
        comment=comment
    )
    
    db.session.add(history)
    db.session.commit()
    
    return jsonify(result)

@app.route('/api/workflows/<workflow_id>/status', methods=['GET'])
def get_workflow_status(workflow_id):
    """Get current workflow status"""
    workflow = ApprovalWorkflowModel.query.get(workflow_id)
    if not workflow:
        return jsonify({'error': 'Workflow not found'}), 404
    
    history = ApprovalHistory.query.filter_by(workflow_id=workflow_id).all()
    
    return jsonify({
        'workflow_id': workflow.id,
        'doc_id': workflow.doc_id,
        'current_stage': workflow.current_stage,
        'status': workflow.status,
        'config': workflow.workflow_config,
        'history': [{
            'user_id': h.user_id,
            'stage': h.stage,
            'decision': h.decision,
            'comment': h.comment,
            'timestamp': h.timestamp.isoformat()
        } for h in history]
    })
```

**Frontend Workflow Builder:**

```javascript
// static/js/workflow_builder.js
class WorkflowBuilder {
    constructor() {
        this.stages = [];
    }
    
    openBuilder() {
        const modal = document.createElement('div');
        modal.className = 'workflow-builder-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Configure Approval Workflow</h3>
                
                <div class="workflow-type">
                    <label>Workflow Type:</label>
                    <select id="workflow-type">
                        <option value="sequential">Sequential (one at a time)</option>
                        <option value="parallel">Parallel (all at once)</option>
                    </select>
                </div>
                
                <div id="workflow-stages">
                    <h4>Approval Stages</h4>
                    <div id="stages-list"></div>
                    <button id="add-stage" class="btn-secondary">+ Add Stage</button>
                </div>
                
                <div class="workflow-preview">
                    <h4>Workflow Preview</h4>
                    <div id="workflow-diagram"></div>
                </div>
                
                <div class="modal-actions">
                    <button id="save-workflow" class="btn-primary">Save Workflow</button>
                    <button id="cancel-workflow" class="btn-secondary">Cancel</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        document.getElementById('add-stage').addEventListener('click', () => {
            this.addStage();
        });
        
        document.getElementById('save-workflow').addEventListener('click', () => {
            this.saveWorkflow();
            modal.remove();
        });
        
        document.getElementById('cancel-workflow').addEventListener('click', () => {
            modal.remove();
        });
    }
    
    addStage() {
        const stage = {
            name: `Stage ${this.stages.length + 1}`,
            approvers: [],
            due_days: 3,
            required: true
        };
        
        this.stages.push(stage);
        this.renderStages();
    }
    
    renderStages() {
        const list = document.getElementById('stages-list');
        list.innerHTML = '';
        
        this.stages.forEach((stage, index) => {
            const stageEl = document.createElement('div');
            stageEl.className = 'workflow-stage';
            stageEl.innerHTML = `
                <div class="stage-header">
                    <input type="text" value="${stage.name}" 
                           class="stage-name" data-index="${index}">
                    <button class="remove-stage" data-index="${index}">✕</button>
                </div>
                <div class="stage-config">
                    <label>Approvers:</label>
                    <div class="approvers-list" id="approvers-${index}">
                        ${stage.approvers.map(a => `
                            <span class="approver-tag">${a.name} ✕</span>
                        `).join('')}
                    </div>
                    <button class="add-approver" data-index="${index}">+ Add Approver</button>
                    
                    <label>Due in (days):</label>
                    <input type="number" value="${stage.due_days}" 
                           class="stage-due-days" data-index="${index}" min="1">
                </div>
            `;
            
            list.appendChild(stageEl);
        });
        
        this.renderDiagram();
    }
    
    renderDiagram() {
        const diagram = document.getElementById('workflow-diagram');
        const workflowType = document.getElementById('workflow-type').value;
        
        let html = '<div class="workflow-flow">';
        
        if (workflowType === 'sequential') {
            this.stages.forEach((stage, index) => {
                html += `
                    <div class="workflow-node">
                        <div class="node-title">${stage.name}</div>
                        <div class="node-approvers">
                            ${stage.approvers.length} approver(s)
                        </div>
                    </div>
                `;
                
                if (index < this.stages.length - 1) {
                    html += '<div class="workflow-arrow">→</div>';
                }
            });
        } else {
            // Parallel visualization
            html += '<div class="parallel-stages">';
            this.stages.forEach(stage => {
                html += `
                    <div class="workflow-node parallel">
                        <div class="node-title">${stage.name}</div>
                        <div class="node-approvers">
                            ${stage.approvers.length} approver(s)
                        </div>
                    </div>
                `;
            });
            html += '</div>';
        }
        
        html += '</div>';
        diagram.innerHTML = html;
    }
    
    async saveWorkflow() {
        const workflowConfig = {
            type: document.getElementById('workflow-type').value,
            stages: this.stages
        };
        
        const response = await fetch(`/api/workflows/${state.currentDoc.id}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({config: workflowConfig})
        });
        
        const data = await response.json();
        alert(`Workflow created! ID: ${data.workflow_id}`);
    }
}

// CSS for workflow builder
const WORKFLOW_CSS = `
.workflow-builder-modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.workflow-builder-modal .modal-content {
    background: white;
    padding: 24px;
    border-radius: 12px;
    width: 800px;
    max-height: 90vh;
    overflow-y: auto;
}

.workflow-stage {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 12px;
}

.stage-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.stage-name {
    font-size: 16px;
    font-weight: 600;
    border: 1px solid #d1d5db;
    padding: 6px 12px;
    border-radius: 4px;
    flex: 1;
    margin-right: 8px;
}

.approver-tag {
    display: inline-block;
    background: #3b82f6;
    color: white;
    padding: 4px 12px;
    border-radius: 16px;
    margin-right: 8px;
    font-size: 14px;
    cursor: pointer;
}

.workflow-flow {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    padding: 20px;
    background: #f9fafb;
    border-radius: 8px;
}

.workflow-node {
    background: white;
    border: 2px solid #3b82f6;
    border-radius: 8px;
    padding: 12px 16px;
    text-align: center;
    min-width: 120px;
}

.workflow-node.parallel {
    border-color: #10b981;
}

.workflow-arrow {
    font-size: 24px;
    color: #6b7280;
    font-weight: bold;
}

.parallel-stages {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
`;
```

**Estimated Implementation Time:** 2-3 weeks
**Dependencies:** None (pure Python/JS)

---

## Priority 4: Advanced Analytics & Tracking

### Current State
- No document analytics
- No client engagement tracking
- No performance metrics

### Enhancement: Document Analytics Dashboard

**What Commercial Tools Have:**[web:56][web:59][web:63]
- Real-time document viewing tracking
- Time spent on each section
- Client engagement metrics
- Conversion funnel analytics
- Team performance dashboards
- Revenue forecasting

**Implementation:**

```python
# app/analytics.py
from datetime import datetime, timedelta
from sqlalchemy import func
from typing import Dict, List

class DocumentAnalytics(db.Model):
    __tablename__ = 'document_analytics'
    
    id = db.Column(db.String(50), primary_key=True)
    doc_id = db.Column(db.String(50), nullable=False, index=True)
    publish_id = db.Column(db.String(50), index=True)
    event_type = db.Column(db.String(50), nullable=False)  # 'view', 'scroll', 'section_view', 'download', 'sign'
    event_data = db.Column(db.JSON)  # Additional event-specific data
    user_agent = db.Column(db.String(255))
    ip_address = db.Column(db.String(45))
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)

class AnalyticsService:
    @staticmethod
    def track_event(doc_id: str, event_type: str, event_data: Dict = None,
                   publish_id: str = None, request_obj = None):
        """Track analytics event"""
        event = DocumentAnalytics(
            id=uid('event'),
            doc_id=doc_id,
            publish_id=publish_id,
            event_type=event_type,
            event_data=event_data or {},
            user_agent=request_obj.headers.get('User-Agent') if request_obj else None,
            ip_address=request_obj.remote_addr if request_obj else None
        )
        
        db.session.add(event)
        db.session.commit()
    
    @staticmethod
    def get_document_stats(doc_id: str) -> Dict:
        """Get aggregated stats for a document"""
        # Total views
        total_views = DocumentAnalytics.query.filter_by(
            doc_id=doc_id,
            event_type='view'
        ).count()
        
        # Unique viewers
        unique_ips = db.session.query(
            func.count(func.distinct(DocumentAnalytics.ip_address))
        ).filter_by(
            doc_id=doc_id,
            event_type='view'
        ).scalar()
        
        # Average time spent (if tracked)
        time_events = DocumentAnalytics.query.filter_by(
            doc_id=doc_id,
            event_type='time_spent'
        ).all()
        
        avg_time_spent = 0
        if time_events:
            total_time = sum(e.event_data.get('seconds', 0) for e in time_events)
            avg_time_spent = total_time / len(time_events)
        
        # Most viewed sections
        section_views = db.session.query(
            DocumentAnalytics.event_data['section'].astext,
            func.count(DocumentAnalytics.id)
        ).filter_by(
            doc_id=doc_id,
            event_type='section_view'
        ).group_by(DocumentAnalytics.event_data['section'].astext).all()
        
        # Conversion metrics
        downloads = DocumentAnalytics.query.filter_by(
            doc_id=doc_id,
            event_type='download'
        ).count()
        
        signatures = DocumentAnalytics.query.filter_by(
            doc_id=doc_id,
            event_type='sign'
        ).count()
        
        # Recent activity (last 7 days)
        week_ago = datetime.utcnow() - timedelta(days=7)
        recent_views = DocumentAnalytics.query.filter(
            DocumentAnalytics.doc_id == doc_id,
            DocumentAnalytics.event_type == 'view',
            DocumentAnalytics.timestamp >= week_ago
        ).count()
        
        return {
            'doc_id': doc_id,
            'total_views': total_views,
            'unique_viewers': unique_ips,
            'recent_views_7d': recent_views,
            'avg_time_spent_seconds': round(avg_time_spent, 2),
            'section_views': [{'section': s[0], 'views': s[1]} for s in section_views],
            'downloads': downloads,
            'signatures': signatures,
            'conversion_rate': round((signatures / total_views * 100) if total_views > 0 else 0, 2)
        }
    
    @staticmethod
    def get_team_analytics(user_id: str, days: int = 30) -> Dict:
        """Get analytics for all documents by user"""
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        # Get all docs for user (simplified - would need user_doc mapping)
        docs = Document.query.filter_by(user_id=user_id).all()
        doc_ids = [d.id for d in docs]
        
        # Aggregate stats
        total_views = DocumentAnalytics.query.filter(
            DocumentAnalytics.doc_id.in_(doc_ids),
            DocumentAnalytics.event_type == 'view',
            DocumentAnalytics.timestamp >= cutoff
        ).count()
        
        total_signatures = DocumentAnalytics.query.filter(
            DocumentAnalytics.doc_id.in_(doc_ids),
            DocumentAnalytics.event_type == 'sign',
            DocumentAnalytics.timestamp >= cutoff
        ).count()
        
        # Top performing documents
        top_docs = db.session.query(
            DocumentAnalytics.doc_id,
            func.count(DocumentAnalytics.id).label('view_count')
        ).filter(
            DocumentAnalytics.doc_id.in_(doc_ids),
            DocumentAnalytics.event_type == 'view',
            DocumentAnalytics.timestamp >= cutoff
        ).group_by(DocumentAnalytics.doc_id).order_by(
            func.count(DocumentAnalytics.id).desc()
        ).limit(5).all()
        
        return {
            'period_days': days,
            'total_documents': len(docs),
            'total_views': total_views,
            'total_signatures': total_signatures,
            'conversion_rate': round((total_signatures / total_views * 100) if total_views > 0 else 0, 2),
            'top_documents': [{'doc_id': d[0], 'views': d[1]} for d in top_docs]
        }

# Flask routes
@app.route('/api/analytics/document/<doc_id>', methods=['GET'])
def get_document_analytics(doc_id):
    """Get analytics for specific document"""
    stats = AnalyticsService.get_document_stats(doc_id)
    return jsonify(stats)

@app.route('/api/analytics/team', methods=['GET'])
def get_team_analytics():
    """Get team-wide analytics"""
    user_id = request.args.get('user_id')
    days = int(request.args.get('days', 30))
    
    stats = AnalyticsService.get_team_analytics(user_id, days)
    return jsonify(stats)

@app.route('/api/analytics/track', methods=['POST'])
def track_analytics_event():
    """Track analytics event from client"""
    data = request.json
    
    AnalyticsService.track_event(
        doc_id=data['doc_id'],
        event_type=data['event_type'],
        event_data=data.get('event_data'),
        publish_id=data.get('publish_id'),
        request_obj=request
    )
    
    return jsonify({'status': 'tracked'})

# Add tracking to published document view
@app.route('/p/<publish_id>', methods=['GET'])
def view_published_doc_with_tracking(publish_id):
    # ... existing view logic ...
    
    # Track view event
    if doc:
        AnalyticsService.track_event(
            doc_id=doc.doc_id,
            event_type='view',
            publish_id=publish_id,
            request_obj=request
        )
    
    return render_template('published_doc.html', ...)
```

**Frontend Analytics Tracking:**

```javascript
// static/js/analytics_tracker.js
class AnalyticsTracker {
    constructor(docId, publishId = null) {
        this.docId = docId;
        this.publishId = publishId;
        this.startTime = Date.now();
        this.sectionTimings = {};
        
        this.setupTracking();
    }
    
    setupTracking() {
        // Track time on page
        window.addEventListener('beforeunload', () => {
            this.trackTimeSpent();
        });
        
        // Track scroll depth
        let scrollTimeout;
        window.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                this.trackScrollDepth();
            }, 1000);
        });
        
        // Track section views using Intersection Observer
        this.observeSections();
        
        // Track downloads
        document.addEventListener('click', (e) => {
            if (e.target.matches('[data-action="download"]')) {
                this.track('download');
            }
        });
    }
    
    async track(eventType, eventData = {}) {
        try {
            await fetch('/api/analytics/track', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    doc_id: this.docId,
                    publish_id: this.publishId,
                    event_type: eventType,
                    event_data: eventData
                })
            });
        } catch (err) {
            console.error('Analytics tracking failed:', err);
        }
    }
    
    trackTimeSpent() {
        const seconds = Math.round((Date.now() - this.startTime) / 1000);
        this.track('time_spent', {seconds});
    }
    
    trackScrollDepth() {
        const scrollPercentage = Math.round(
            (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100
        );
        
        this.track('scroll', {percentage: scrollPercentage});
    }
    
    observeSections() {
        const sections = document.querySelectorAll('h2, h3');
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const sectionName = entry.target.textContent;
                    
                    if (!this.sectionTimings[sectionName]) {
                        this.sectionTimings[sectionName] = Date.now();
                        this.track('section_view', {section: sectionName});
                    }
                }
            });
        }, {threshold: 0.5});
        
        sections.forEach(section => observer.observe(section));
    }
}

// Initialize on published document pages
if (window.PUBLISHED_DOC_ID) {
    new AnalyticsTracker(window.DOC_ID, window.PUBLISHED_DOC_ID);
}
```

**Analytics Dashboard UI:**

```javascript
// static/js/analytics_dashboard.js
class AnalyticsDashboard {
    async loadStats(docId) {
        const response = await fetch(`/api/analytics/document/${docId}`);
        const stats = await response.json();
        
        this.renderDashboard(stats);
    }
    
    renderDashboard(stats) {
        const dashboard = document.getElementById('analytics-dashboard');
        
        dashboard.innerHTML = `
            <div class="analytics-grid">
                <div class="stat-card">
                    <div class="stat-value">${stats.total_views}</div>
                    <div class="stat-label">Total Views</div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-value">${stats.unique_viewers}</div>
                    <div class="stat-label">Unique Viewers</div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-value">${stats.avg_time_spent_seconds}s</div>
                    <div class="stat-label">Avg Time Spent</div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-value">${stats.conversion_rate}%</div>
                    <div class="stat-label">Conversion Rate</div>
                </div>
            </div>
            
            <div class="section-heatmap">
                <h4>Section Engagement</h4>
                ${this.renderSectionHeatmap(stats.section_views)}
            </div>
        `;
    }
    
    renderSectionHeatmap(sectionViews) {
        if (!sectionViews || sectionViews.length === 0) {
            return '<p>No section data available</p>';
        }
        
        const maxViews = Math.max(...sectionViews.map(s => s.views));
        
        let html = '<div class="heatmap">';
        sectionViews.forEach(section => {
            const intensity = (section.views / maxViews) * 100;
            html += `
                <div class="heatmap-item" style="background: rgba(59, 130, 246, ${intensity/100})">
                    <span class="section-name">${section.section}</span>
                    <span class="section-views">${section.views} views</span>
                </div>
            `;
        });
        html += '</div>';
        
        return html;
    }
}
```

**Estimated Implementation Time:** 1-2 weeks
**Dependencies:** None (SQLAlchemy, vanilla JS)

---

## Priority 5: Mobile-Responsive Signature Capture

### Current State
- Desktop-only text input for signatures
- No touch-friendly signature drawing
- No mobile optimization

### Enhancement: Touch-Enabled Signature Pad

**What Commercial Tools Have:**[web:59][web:62][web:65]
- Touch-friendly signature canvas
- Mobile-responsive signing flow
- SMS signature requests
- QR code signing links

**Implementation:**

```javascript
// static/js/signature_pad.js
class SignaturePad {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.isDrawing = false;
        this.points = [];
        
        this.setupCanvas();
        this.attachEvents();
    }
    
    setupCanvas() {
        // Set canvas size
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = 150;
        
        // Style
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = 2;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
    }
    
    attachEvents() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stopDrawing());
        this.canvas.addEventListener('mouseout', () => this.stopDrawing());
        
        // Touch events for mobile
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.startDrawing(e.touches[0]);
        });
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.draw(e.touches[0]);
        });
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.stopDrawing();
        });
    }
    
    startDrawing(e) {
        this.isDrawing = true;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        this.points.push({x, y});
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
    }
    
    draw(e) {
        if (!this.isDrawing) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        this.points.push({x, y});
        this.ctx.lineTo(x, y);
        this.ctx.stroke();
    }
    
    stopDrawing() {
        if (!this.isDrawing) return;
        
        this.isDrawing = false;
        this.ctx.closePath();
    }
    
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.points = [];
    }
    
    isEmpty() {
        return this.points.length === 0;
    }
    
    toDataURL() {
        return this.canvas.toDataURL('image/png');
    }
    
    toJSON() {
        return {
            points: this.points,
            width: this.canvas.width,
            height: this.canvas.height
        };
    }
}

// Usage in signing flow
function openSignatureModal(role) {
    const modal = document.createElement('div');
    modal.className = 'signature-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Sign as ${role}</h3>
            
            <div class="signature-tabs">
                <button class="tab active" data-tab="draw">Draw</button>
                <button class="tab" data-tab="type">Type</button>
            </div>
            
            <div class="tab-content" data-tab="draw">
                <canvas id="signature-canvas"></canvas>
                <button id="clear-signature" class="btn-secondary">Clear</button>
            </div>
            
            <div class="tab-content hidden" data-tab="type">
                <input type="text" id="typed-signature" 
                       placeholder="Type your name" 
                       style="font-family: 'Brush Script MT', cursive; font-size: 24px;">
            </div>
            
            <div class="signer-details">
                <input type="text" id="signer-name" placeholder="Full Name" required>
                <input type="email" id="signer-email" placeholder="Email (optional)">
            </div>
            
            <div class="modal-actions">
                <button id="save-signature" class="btn-primary">Confirm Signature</button>
                <button id="cancel-signature" class="btn-secondary">Cancel</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const signaturePad = new SignaturePad('signature-canvas');
    
    // Tab switching
    modal.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            modal.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            modal.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
            
            tab.classList.add('active');
            modal.querySelector(`.tab-content[data-tab="${tab.dataset.tab}"]`).classList.remove('hidden');
        });
    });
    
    document.getElementById('clear-signature').addEventListener('click', () => {
        signaturePad.clear();
    });
    
    document.getElementById('save-signature').addEventListener('click', async () => {
        const signerName = document.getElementById('signer-name').value;
        const signerEmail = document.getElementById('signer-email').value;
        
        if (!signerName) {
            alert('Please enter your full name');
            return;
        }
        
        const activeTab = modal.querySelector('.tab.active').dataset.tab;
        let signatureData;
        
        if (activeTab === 'draw') {
            if (signaturePad.isEmpty()) {
                alert('Please draw your signature');
                return;
            }
            signatureData = {
                type: 'drawn',
                data: signaturePad.toDataURL()
            };
        } else {
            const typedSig = document.getElementById('typed-signature').value;
            if (!typedSig) {
                alert('Please type your name');
                return;
            }
            signatureData = {
                type: 'typed',
                data: typedSig
            };
        }
        
        await submitSignature(role, signerName, signerEmail, signatureData);
        modal.remove();
    });
    
    document.getElementById('cancel-signature').addEventListener('click', () => {
        modal.remove();
    });
}

async function submitSignature(role, name, email, signatureData) {
    // Submit to backend
    const response = await fetch('/api/signatures', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            doc_id: state.currentDoc.id,
            revision: state.activeRevision,
            role: role,
            signer_name: name,
            signer_email: email,
            signature: signatureData,
            timestamp: new Date().toISOString(),
            ip_address: await fetch('https://api.ipify.org?format=json')
                .then(r => r.json())
                .then(d => d.ip)
                .catch(() => 'unknown')
        })
    });
    
    if (response.ok) {
        // Reload document to show signature
        bindDocToUi();
    }
}
```

**Estimated Implementation Time:** 3-5 days
**Dependencies:** None (vanilla JS Canvas API)

---

## Summary: Feature Parity Roadmap

| Feature | Priority | Est. Time | Status | Commercial Equivalent |
|---------|----------|-----------|--------|-----------------------|
| Real-time collaboration | P1 | 2-3 weeks | Planned | PandaDoc Workspaces ($588/yr) |
| AI content assistance | P2 | 1-2 weeks | Planned | Highspot Autodocs ($3000+/yr) |
| Advanced approval workflows | P3 | 2-3 weeks | Planned | PandaDoc Business ($588/yr) |
| Analytics dashboard | P4 | 1-2 weeks | Planned | PandaDoc Analytics ($588/yr) |
| Mobile signature pad | P5 | 3-5 days | Planned | Dropbox Sign ($300/yr) |
| Template library | P6 | 1 week | Planned | PandaDoc Templates |
| CRM integrations | P7 | 2-3 weeks | Planned | PandaDoc Integrations |
| Bulk sending | P8 | 1 week | Planned | PandaDoc Bulk Send |
| Advanced reporting | P9 | 1-2 weeks | Planned | Enterprise features |
| White-label branding | P10 | 3-5 days | Planned | PandaDoc Custom Branding |

**Total Implementation:** ~12-16 weeks for all priority features

**Cost Savings:** Users save $200-600/year per user while getting equivalent features

---

## Quick Wins (Can Implement in <1 Week Each)

### 1. Template Library
- Pre-built industry-specific templates (IT consulting, design, marketing, legal, etc.)
- One-click template application
- Community template sharing

### 2. Email Notifications
- SMTP integration for document sharing
- Approval reminders
- Signature request emails

### 3. Bulk Operations
- Bulk export multiple documents
- Batch apply clause packs
- Multi-document search

### 4. Enhanced Export Options
- Word/DOCX export
- Excel pricing table export
- Batch PDF generation

### 5. Version Comparison View
- Side-by-side revision diff
- Highlight changes between versions
- Merge revision branches

---

## Next Steps

1. **Prioritize based on user feedback**: Survey users to determine which features are most valuable
2. **Start with Quick Wins**: Build template library and email notifications first
3. **Implement P1-P3 features**: Focus on collaboration, AI assistance, and approval workflows
4. **Build community**: Encourage template contributions and feature requests
5. **Document everything**: Keep this roadmap updated as features are completed

**Goal:** Achieve feature parity with $500+/year commercial tools while remaining 100% free and open-source.