from django import forms
from .models import Room

class RoomForm(forms.ModelForm):
    password = forms.CharField(
        widget=forms.PasswordInput(render_value=True),
        required=False,
        help_text="Required if room is private"
    )
    
    class Meta:
        model = Room
        fields = [
            'name', 'description', 'is_private', 
            'password', 'max_users', 'allow_screen_share', 
            'allow_chat'
        ]
        widgets = {
            'description': forms.Textarea(attrs={'rows': 3}),
        }
    
    def clean(self):
        cleaned_data = super().clean()
        is_private = cleaned_data.get('is_private')
        password = cleaned_data.get('password')
        
        if is_private and not password:
            raise forms.ValidationError("Password is required for private rooms")
        
        return cleaned_data